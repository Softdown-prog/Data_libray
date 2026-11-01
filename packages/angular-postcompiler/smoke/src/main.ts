import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
@Component({ selector: 'sac-smoke', standalone: true, template: '<h1>Official Angular build fixture</h1>' })
class Smoke {}
bootstrapApplication(Smoke).catch(console.error);
