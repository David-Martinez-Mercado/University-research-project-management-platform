import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell, Button, Card, Input } from '.';

describe('shared UI components', () => {
  it('Button blocks clicks and reports busy state while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.setup().click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Input links label, hint and error for assistive technology', () => {
    render(<Input label="Email" hint="Use your university address" error="Required" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Use your university address Required');
  });

  it('Card renders title, body and footer', () => {
    render(
      <Card title="Title" footer="Foot">
        Body
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Foot')).toBeInTheDocument();
  });

  it('AppShell shows user name, role and a working logout button', async () => {
    const onLogout = vi.fn();
    render(
      <AppShell user={{ fullName: 'Ada Admin', role: 'ADMINISTRATOR' }} onLogout={onLogout}>
        content
      </AppShell>,
    );
    expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Log out' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
