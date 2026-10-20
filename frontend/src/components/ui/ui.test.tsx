import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  AppShell,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Input,
  Pagination,
  Select,
  Spinner,
  Tabs,
  Textarea,
} from '.';

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
      <MemoryRouter>
        <AppShell user={{ fullName: 'Ada Admin', role: 'ADMINISTRATOR' }} onLogout={onLogout}>
          content
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('AppShell renders the role navigation, marks the current page and offers a skip link', () => {
    render(
      <MemoryRouter initialEntries={['/projects/new']}>
        <AppShell
          user={{ fullName: 'Rita', role: 'RESEARCHER' }}
          nav={[
            { to: '/', label: 'Mis proyectos', end: true },
            { to: '/projects/new', label: 'Nuevo proyecto' },
          ]}
        >
          content
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nuevo proyecto' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Mis proyectos' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toHaveAttribute('href', '#contenido');
  });

  it('Badge carries its meaning in text', () => {
    render(<Badge tone="danger">Falló</Badge>);
    expect(screen.getByText('Falló')).toBeVisible();
  });

  it('Select and Textarea link label, hint and error like Input', () => {
    render(
      <>
        <Select label="Tipo" hint="Elige uno" error="Obligatorio">
          <option value="a">A</option>
        </Select>
        <Textarea label="Notas" error="Muy largo" />
      </>,
    );
    expect(screen.getByLabelText('Tipo')).toHaveAccessibleDescription('Elige uno Obligatorio');
    expect(screen.getByLabelText('Tipo')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Notas')).toHaveAccessibleDescription('Muy largo');
  });

  it('Spinner announces itself and EmptyState shows its call to action', () => {
    render(
      <>
        <Spinner label="Cargando cosas" />
        <EmptyState title="Nada aún" description="Crea algo" action={<Button>Crear</Button>} />
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Cargando cosas');
    expect(screen.getByText('Nada aún')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument();
  });

  it('ButtonLink is a link styled like a Button', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/x">Ir</ButtonLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Ir' })).toHaveAttribute('href', '/x');
  });

  it('Pagination reports the range and moves by limit', async () => {
    const onChange = vi.fn();
    render(<Pagination total={25} limit={10} offset={10} onChange={onChange} />);
    expect(screen.getByText('Mostrando 11–20 de 25')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(onChange).toHaveBeenLastCalledWith(20);
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('Pagination renders nothing for an empty result and disables the last Next', () => {
    const { container, rerender } = render(<Pagination total={0} limit={10} offset={0} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Pagination total={25} limit={10} offset={20} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('Tabs: roving tabindex, arrow/Home/End keys, wrap-around and tabpanel labelling', async () => {
    function Harness() {
      const [id, setId] = useState('a');
      return (
        <Tabs
          label="Secciones"
          selectedId={id}
          onSelect={setId}
          tabs={[
            { id: 'a', label: 'Uno' },
            { id: 'b', label: 'Dos' },
            { id: 'c', label: 'Tres' },
          ]}
        >
          panel-{id}
        </Tabs>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    const [a, b, c] = screen.getAllByRole('tab');

    expect(screen.getByRole('tablist', { name: 'Secciones' })).toBeInTheDocument();
    expect([a, b, c].map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Uno');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel-a');

    a.focus();
    await user.keyboard('{ArrowRight}');
    expect(b).toHaveFocus();
    expect(b).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel-b');
    await user.keyboard('{End}');
    expect(c).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(a).toHaveFocus(); // wraps
    await user.keyboard('{ArrowLeft}');
    expect(c).toHaveFocus(); // wraps back
    await user.keyboard('{Home}');
    expect(a).toHaveFocus();
    await user.click(b);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Dos');
  });
});
