import { describe, it, expect } from 'vitest';
import {
  newNotifierForm,
  formFromDto,
  toggleEvent,
  buildConfigPayload,
  buildNotifierBody,
  buildNotifierTestBody,
  validateNotifierForm,
  type NotifierFormState,
} from './settings-notifiers';
import { NOTIFIER_REGISTRY } from '@shared/notifier-registry';
import type { KnownNotifierDto } from '@shared/schemas/connectors';

describe('newNotifierForm', () => {
  it('seeds blank fields, all events, enabled by default', () => {
    const f = newNotifierForm('ntfy');
    expect(f).toMatchObject({ id: null, type: 'ntfy', enabled: true });
    expect(f.events).toEqual(['request.created', 'user.pending']);
    expect(f.fields).toEqual({ url: '', topic: '', token: '', priority: '' });
  });

  it('seeds checkbox fields as false (email.secure)', () => {
    expect(newNotifierForm('email').fields.secure).toBe(false);
  });
});

describe('formFromDto', () => {
  it('seeds an edit form from a masked DTO — secrets blank, has* carried, values filled', () => {
    const dto: KnownNotifierDto = {
      id: 'nf_1',
      name: 'Phone',
      type: 'ntfy',
      enabled: false,
      events: ['user.pending'],
      config: { url: 'https://ntfy.sh', topic: 'reqs', hasToken: true, priority: 'high' },
    };
    const f = formFromDto(dto);
    expect(f).toMatchObject({ id: 'nf_1', name: 'Phone', enabled: false, events: ['user.pending'] });
    expect(f.fields).toMatchObject({ url: 'https://ntfy.sh', topic: 'reqs', token: '', priority: 'high' });
    expect(f.has.token).toBe(true);
  });

  it('reads the has* flag for a webhook capability URL (config has no plaintext url)', () => {
    const dto: KnownNotifierDto = {
      id: 'nf_2',
      name: 'Discord',
      type: 'webhook',
      enabled: true,
      events: ['request.created'],
      config: { hasUrl: true, urlHint: 'discord.com/…' },
    };
    const f = formFromDto(dto);
    expect(f.fields.url).toBe('');
    expect(f.has.url).toBe(true);
  });
});

describe('toggleEvent', () => {
  it('removes a present key and re-adds in registry order', () => {
    expect(toggleEvent(['request.created', 'user.pending'], 'request.created')).toEqual(['user.pending']);
    expect(toggleEvent(['user.pending'], 'request.created')).toEqual(['request.created', 'user.pending']);
  });
});

describe('buildConfigPayload — omit-to-keep secret encoding', () => {
  const ntfyDef = NOTIFIER_REGISTRY.ntfy;
  const state = (over: Partial<NotifierFormState['fields']>, has: Record<string, boolean> = {}): NotifierFormState => ({
    ...newNotifierForm('ntfy'),
    fields: { url: 'https://ntfy.sh', topic: 'reqs', token: '', priority: '', ...over },
    has,
  });

  it('omits a blank secret (keep stored) and includes a typed one verbatim (password kind)', () => {
    expect(buildConfigPayload(ntfyDef, state({ token: '' }))).not.toHaveProperty('token');
    // ntfy token is a password-kind secret → kept verbatim (the server trims it).
    expect(buildConfigPayload(ntfyDef, state({ token: '  tok  ' })).token).toBe('  tok  ');
    expect(buildConfigPayload(ntfyDef, state({ token: 'tok' })).token).toBe('tok');
  });

  it('collapses an empty optional non-secret to null (priority)', () => {
    expect(buildConfigPayload(ntfyDef, state({ priority: '' })).priority).toBeNull();
    expect(buildConfigPayload(ntfyDef, state({ priority: 'high' })).priority).toBe('high');
  });

  it('omits an empty number field (email.port) so the server default applies', () => {
    const emailDef = NOTIFIER_REGISTRY.email;
    const f: NotifierFormState = {
      ...newNotifierForm('email'),
      fields: { host: 'smtp.x', port: '', secure: true, user: '', pass: '', from: 'a@x', to: 'b@x' },
      has: {},
    };
    const payload = buildConfigPayload(emailDef, f);
    expect(payload).not.toHaveProperty('port');
    expect(payload.secure).toBe(true);
    expect(payload.user).toBeNull();
    expect(payload).not.toHaveProperty('pass');
  });

  it('trims a webhook capability URL secret', () => {
    const webhookDef = NOTIFIER_REGISTRY.webhook;
    const f: NotifierFormState = { ...newNotifierForm('webhook'), fields: { url: '  https://x/h  ' }, has: {} };
    expect(buildConfigPayload(webhookDef, f).url).toBe('https://x/h');
  });
});

describe('buildNotifierBody / buildNotifierTestBody', () => {
  it('builds a create body with a trimmed name', () => {
    const f = { ...newNotifierForm('ntfy'), name: '  Phone  ', fields: { url: 'https://ntfy.sh', topic: 'reqs', token: '', priority: '' } };
    expect(buildNotifierBody(f)).toMatchObject({ name: 'Phone', type: 'ntfy', events: ['request.created', 'user.pending'] });
  });

  it('test body carries id when editing and publicUrl when set; omits publicUrl when null', () => {
    const editForm: NotifierFormState = { ...newNotifierForm('ntfy'), id: 'nf_1', fields: { url: 'https://ntfy.sh', topic: 'reqs', token: '', priority: '' } };
    expect(buildNotifierTestBody(editForm, 'https://app.com')).toMatchObject({ type: 'ntfy', id: 'nf_1', publicUrl: 'https://app.com' });
    expect(buildNotifierTestBody(newNotifierForm('ntfy'), null)).not.toHaveProperty('publicUrl');
    expect(buildNotifierTestBody(newNotifierForm('ntfy'), null)).not.toHaveProperty('id');
  });
});

describe('validateNotifierForm', () => {
  const valid: NotifierFormState = {
    ...newNotifierForm('ntfy'),
    name: 'Phone',
    fields: { url: 'https://ntfy.sh', topic: 'reqs', token: '', priority: '' },
  };

  it('passes a valid form', () => {
    expect(validateNotifierForm(valid)).toEqual({});
  });

  it('flags an empty name and zero events', () => {
    expect(validateNotifierForm({ ...valid, name: '   ' }).name).toBeDefined();
    expect(validateNotifierForm({ ...valid, events: [] }).events).toBeDefined();
  });

  it('flags a missing required non-secret field (ntfy topic)', () => {
    expect(validateNotifierForm({ ...valid, fields: { ...valid.fields, topic: '' } }).topic).toBeDefined();
  });

  it('requires a required secret on CREATE but accepts omit-to-keep on EDIT (has flag)', () => {
    const createForm: NotifierFormState = { ...newNotifierForm('webhook'), name: 'D', fields: { url: '' }, has: {} };
    expect(validateNotifierForm(createForm).url).toBeDefined();

    const editForm: NotifierFormState = { ...createForm, id: 'nf_1', has: { url: true } };
    expect(validateNotifierForm(editForm).url).toBeUndefined();
  });
});
