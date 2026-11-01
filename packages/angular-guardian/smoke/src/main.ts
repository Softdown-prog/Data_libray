import { Component, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { mode } from './mode';
@Component({ selector: 'sac-smoke', standalone: true, template: '<h1>Angular runtime fixture</h1><button (click)="act()">Run</button>@if(done()){<p class="done">Changed</p>}' })
class Smoke {
  done = signal(false);
  act() {
    switch (mode) {
      case 'broken': return;
      case 'runtime': throw new Error('synthetic-runtime-error');
      case 'http': fetch('/nonexistent'); break;
      case 'external': fetch('http://192.0.2.1/private'); break;
      case 'websocket': new WebSocket('ws://127.0.0.1:1/private'); break;
      case 'popup': window.open('http://127.0.0.1:1/private'); break;
      case 'redirect': location.href = 'http://192.0.2.1/private'; break;
    }
    this.done.set(true);
  }
}
bootstrapApplication(Smoke).catch(console.error);
