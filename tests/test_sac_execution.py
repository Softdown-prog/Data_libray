"""SAC-008C offline tests: checked identities, no arbitrary execution, no false-pass."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import sac_execution as se
from scripts import sac_job_queue as q

class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.job = {"schema_version":1,"job_id":"gha-789-1","project_id":"example-a",
                    "profile_id":"angular-root","source_sha":"a"*40,"kind":"angular-validate"}
        self.policy = {"schema_version":1,"projects":[{"project_id":"example-a","profile_id":"angular-root"}]}
        self.registry = {"schema_version":1,"projects":[{"project_id":"example-a","profile_id":"angular-root",
                                                          "manifest":"/etc/data-library-worker/auditors/example-a.json"}]}
        q.enqueue(self.root,self.job,self.policy)
        q.receive_pending(self.root,self.policy)

    def result(self, **fields):
        obj=se._result(self.job, "pass", "isolated-browser-pass", static=True, browser=True)
        obj.update(fields)
        return obj

    def call(self, handler=None, **kw):
        kw.setdefault("executor", "/usr/bin/node")
        return se.execute_received(self.root,self.policy,self.registry,
                                   invoke=handler or (lambda job, manifest, **_: self.result()), **kw)

    def test_admission_and_binding_with_idempotent_result(self):
        self.assertEqual(self.call()["processed"],1)
        state=json.loads((self.root/"sac-results"/"gha-789-1.json").read_text())
        self.assertEqual(state["status"],"pass")
        self.assertFalse(state["deployment_authorized"])
        self.assertEqual(self.call()["processed"],0)

    def test_unverified_and_fail_are_preserved(self):
        self.assertEqual(self.call(lambda *_,**__:se._result(self.job, "unverified","audit-not-verified"))["processed"],1)
        self.assertEqual(json.loads((self.root/"sac-results"/"gha-789-1.json").read_text())["status"],"unverified")

    def test_report_from_another_job_never_passes(self):
        self.call(lambda *_,**__:self.result(source_sha="b"*40))
        result=json.loads((self.root/"sac-results"/"gha-789-1.json").read_text())
        self.assertEqual(result["status"],"infra-error")
        self.assertEqual(result["code"],"audit-runner-error")

    def test_false_success_missing_browser_is_refused(self):
        self.call(lambda *_,**__:self.result(browser_pass=False))
        result=json.loads((self.root/"sac-results"/"gha-789-1.json").read_text())
        self.assertEqual(result["status"],"infra-error")

    def test_unapproved_registry_never_dispatches(self):
        self.registry["projects"]=[]
        handler=lambda *_,**__:self.fail("Unexpected execution")
        self.assertEqual(self.call(handler)["processed"],0)

    def test_missing_receipt_cannot_be_dispatched(self):
        (self.root/"sac-jobs"/"gha-789-1.json").unlink()
        self.assertEqual(self.call()["processed"],0)

    def test_unexpected_binary_cannot_be_selected_by_job(self):
        with self.assertRaises(ValueError):
            self.call(executor="node")
        with self.assertRaises(ValueError):
            self.call(limit=99)
        with self.assertRaises(ValueError):
            se.load_registry({"schema_version":1,"projects":[{
                "project_id":"example-a","profile_id":"angular-root","manifest":"../../tmp/script.js"}]})

    def test_policy_does_not_admit_duplicate(self):
        self.registry["projects"] *= 2
        with self.assertRaises(ValueError):
            self.call()

    def test_runner_invocation_has_fixed_args_not_project_commands(self):
        with patch.object(se.subprocess,"Popen") as popen:
            p=popen.return_value
            p.returncode=0
            p.communicate.return_value=("SAC_AUDIT_RESULT "+json.dumps(self.result())+"\n","")
            result=se._invoke(self.job,self.registry["projects"][0]["manifest"],
                              executor="/usr/bin/node",timeout=150)
        self.assertEqual(result["status"],"pass")
        args=popen.call_args.args[0]
        self.assertEqual(args[0],"/usr/bin/node")
        self.assertEqual(args[2],"--manifest")
        self.assertFalse(any("npm" in x or "bash" in x for x in args))
        self.assertTrue(popen.call_args.kwargs["start_new_session"])

    def fail(self,msg):
        raise AssertionError(msg)

if __name__=="__main__":
    unittest.main()
