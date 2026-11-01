/*
Data Library ID: rust.concurrency.bounded-dispatcher
Propósito: limitar atomicamente tarefas executadas em threads próprias.
Quando usar: pequenas quantidades de tarefas CPU/bloqueantes com limite de simultaneidade.
Quando evitar: executor de alta escala ou pool fixo (uma thread é criada por tarefa).
Erros: capacidade esgotada e falha ao iniciar thread; pânico na tarefa aparece em join().
Correções: consulte README.md e example.json.
*/
use std::io;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

#[derive(Debug)]
pub enum DispatchError {
    AtCapacity,
    Spawn(io::Error),
}

pub struct SystemDispatcher {
    active_workers: Arc<AtomicU32>,
    max_capacity: u32,
}

struct ActiveWorkerGuard(Arc<AtomicU32>);

impl Drop for ActiveWorkerGuard {
    fn drop(&mut self) {
        // Executa também durante unwinding de panic, evitando contador preso.
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl SystemDispatcher {
    #[must_use]
    pub fn new(max_capacity: u32) -> Self {
        Self {
            active_workers: Arc::new(AtomicU32::new(0)),
            max_capacity,
        }
    }

    /// Reserva um slot antes de criar a thread e devolve JoinHandle para observar panic.
    /// Não excede max_capacity mesmo sob chamadas simultâneas.
    pub fn dispatch<F>(&self, task: F) -> Result<JoinHandle<()>, DispatchError>
    where
        F: FnOnce() + Send + 'static,
    {
        let mut current = self.active_workers.load(Ordering::Acquire);
        loop {
            if current >= self.max_capacity {
                return Err(DispatchError::AtCapacity);
            }
            match self.active_workers.compare_exchange_weak(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(updated) => current = updated,
            }
        }

        let workers = Arc::clone(&self.active_workers);
        match thread::Builder::new().spawn(move || {
            let _guard = ActiveWorkerGuard(workers);
            task();
        }) {
            Ok(handle) => Ok(handle),
            Err(error) => {
                // A reserva precisa ser desfeita caso o SO recuse a criação da thread.
                self.active_workers.fetch_sub(1, Ordering::AcqRel);
                Err(DispatchError::Spawn(error))
            }
        }
    }

    #[must_use]
    pub fn active_load(&self) -> u32 {
        self.active_workers.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::Barrier;

    #[test]
    fn rejects_zero_capacity() {
        let dispatcher = SystemDispatcher::new(0);
        assert!(matches!(
            dispatcher.dispatch(|| {}),
            Err(DispatchError::AtCapacity)
        ));
        assert_eq!(dispatcher.active_load(), 0);
    }

    #[test]
    fn rejects_when_workers_are_busy_and_frees_slots() {
        let dispatcher = SystemDispatcher::new(2);
        let barrier = Arc::new(Barrier::new(3));
        let b1 = Arc::clone(&barrier);
        let b2 = Arc::clone(&barrier);
        let first = dispatcher
            .dispatch(move || {
                b1.wait();
            })
            .unwrap();
        let second = dispatcher
            .dispatch(move || {
                b2.wait();
            })
            .unwrap();
        assert_eq!(dispatcher.active_load(), 2);
        assert!(matches!(
            dispatcher.dispatch(|| {}),
            Err(DispatchError::AtCapacity)
        ));
        barrier.wait();
        first.join().unwrap();
        second.join().unwrap();
        assert_eq!(dispatcher.active_load(), 0);
    }

    #[test]
    fn panic_does_not_leak_capacity() {
        let dispatcher = SystemDispatcher::new(1);
        let handle = dispatcher
            .dispatch(|| panic!("intentional failure"))
            .unwrap();
        assert!(handle.join().is_err());
        assert_eq!(dispatcher.active_load(), 0);
        dispatcher.dispatch(|| {}).unwrap().join().unwrap();
    }

    #[test]
    fn concurrent_submitters_never_exceed_limit() {
        let dispatcher = Arc::new(SystemDispatcher::new(4));
        let release = Arc::new(AtomicBool::new(false));
        let barrier = Arc::new(Barrier::new(33));
        let mut callers = Vec::new();
        for _ in 0..32 {
            let dispatcher = Arc::clone(&dispatcher);
            let release = Arc::clone(&release);
            let barrier = Arc::clone(&barrier);
            callers.push(thread::spawn(move || {
                barrier.wait();
                dispatcher.dispatch(move || {
                    while !release.load(Ordering::Acquire) {
                        thread::yield_now();
                    }
                })
            }));
        }
        barrier.wait();
        let mut accepted = Vec::new();
        for caller in callers {
            match caller.join().unwrap() {
                Ok(handle) => accepted.push(handle),
                Err(DispatchError::AtCapacity) => {}
                Err(DispatchError::Spawn(error)) => panic!("thread spawn failed: {error}"),
            }
        }
        assert_eq!(accepted.len(), 4);
        assert_eq!(dispatcher.active_load(), 4);
        release.store(true, Ordering::Release);
        for worker in accepted {
            worker.join().unwrap();
        }
        assert_eq!(dispatcher.active_load(), 0);
    }
}
