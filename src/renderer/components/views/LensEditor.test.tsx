/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LensEditor } from './LensEditor';

describe('LensEditor', () => {
  it('renders form fields from data', () => {
    render(<LensEditor data={{ name: 'Agent', region: 'us-east' }} onSave={vi.fn()} />);
    expect(screen.getByDisplayValue('Agent')).toBeTruthy();
    expect(screen.getByDisplayValue('us-east')).toBeTruthy();
  });

  it('Save button disabled when not dirty', () => {
    render(<LensEditor data={{ name: 'Agent' }} onSave={vi.fn()} />);
    const btn = screen.getByText('Save Changes');
    const button = btn.closest('button');
    if (!button) throw new Error('expected button element');
    expect(button.disabled).toBe(true);
  });

  it('changing input enables Save button', () => {
    render(<LensEditor data={{ name: 'Agent' }} onSave={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('Agent'), { target: { value: 'NewName' } });
    const btn = screen.getByText('Save Changes');
    const button = btn.closest('button');
    if (!button) throw new Error('expected button element');
    expect(button.disabled).toBe(false);
  });

  it('clicking Save calls onSave with updated data', () => {
    const onSave = vi.fn();
    render(<LensEditor data={{ name: 'Agent' }} onSave={onSave} />);
    fireEvent.change(screen.getByDisplayValue('Agent'), { target: { value: 'NewName' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(onSave).toHaveBeenCalledWith({ name: 'NewName' });
  });

  it('enum schema renders select dropdown', () => {
    const schema = { properties: { env: { title: 'Environment', type: 'string', enum: ['dev', 'staging', 'prod'] } } };
    render(<LensEditor data={{ env: 'dev' }} schema={schema} onSave={vi.fn()} />);
    const select = screen.getByDisplayValue('dev') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.options).toHaveLength(3);
  });

  it('boolean schema renders checkbox', () => {
    const schema = { properties: { enabled: { title: 'Enabled', type: 'boolean' } } };
    render(<LensEditor data={{ enabled: true }} schema={schema} onSave={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
