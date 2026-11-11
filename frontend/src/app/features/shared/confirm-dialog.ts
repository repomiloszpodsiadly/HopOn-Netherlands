import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  @Input() dialogId = 'confirm-dialog';
  @Input() title = 'Confirm action';
  @Input() description = '';
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Input() busy = false;
  @Input() message: string | null = null;
  @Output() readonly confirmed = new EventEmitter<void>();
  @Output() readonly cancelled = new EventEmitter<void>();

  @ViewChild('dialog', { static: true }) private readonly dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('cancelButton', { static: true }) private readonly cancelButton!: ElementRef<HTMLButtonElement>;
  private opener: HTMLElement | null = null;

  open(): void {
    const dialog = this.dialog.nativeElement;
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      dialog.showModal();
    } catch {
      dialog.removeAttribute('open');
    }
    dialog.setAttribute('open', '');
    queueMicrotask(() => this.cancelButton.nativeElement.focus());
  }

  close(): void {
    const dialog = this.dialog.nativeElement;
    try {
      if (dialog.open) {
        dialog.close();
      }
    } catch {
      dialog.removeAttribute('open');
    }
    dialog.removeAttribute('open');
    const opener = this.opener;
    this.opener = null;
    queueMicrotask(() => {
      if (opener?.isConnected) {
        opener.focus();
      }
    });
  }

  confirm(): void {
    if (!this.busy) {
      this.confirmed.emit();
    }
  }

  cancel(): void {
    if (this.busy) {
      return;
    }
    this.cancelled.emit();
    this.close();
  }

  handleCancel(event: Event): void {
    event.preventDefault();
    this.cancel();
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const buttons = Array.from(
      this.dialog.nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    );
    const first = buttons[0];
    const last = buttons.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.cancel();
    }
  }
}
