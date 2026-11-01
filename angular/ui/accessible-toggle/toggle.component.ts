import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

@Component({
  selector: 'dl-accessible-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" [attr.aria-pressed]="pressed()" (click)="toggle()">
      {{ pressed() ? 'Ativo' : 'Inativo' }}
    </button>
  `,
})
export class AccessibleToggleComponent {
  readonly pressed = signal(false);

  toggle(): void {
    this.pressed.update((value) => !value);
  }
}
