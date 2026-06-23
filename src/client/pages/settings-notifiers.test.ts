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
  const state = (
    over: Partial<NotifierFormState['fields']>,
    has: Record<string, boolean> = {},
    clear: Record<string, boolean> = {},
  ): NotifierFormState => ({
    ...newNotifierForm('ntfy'),
    fields: { url: 'https://ntfy.sh', topic: 'reqs', token: '', priority: '', ...over },
    has,
    clear,
  });

  it('omits a blank secret (keep stored) and includes a typed one verbatim (password kind)', () => {
    expect(buildConfigPayload(ntfyDef, state({ token: '' }))).not.toHaveProperty('token');
    // ntfy token is a password-kind secret → kept verbatim (the server trims it).
    expect(buildConfigPayload(ntfyDef, state({ token: '  tok  ' })).token).toBe('  tok  ');
    expect(buildConfigPayload(ntfyDef, state({ token: 'tok' })).token).toBe('tok');
  });

  describe('optional-secret clear/replace precedence ladder', () => {
    // ntfy `token` is the optional (non-required) secret; `has.token` marks it stored.
    it('rung 1: non-empty input + clear selected → sends the typed value (replacement wins)', () => {
      const payload = buildConfigPayload(ntfyDef, state({ token: 'new' }, { token: true }, { token: true }));
      expect(payload.token).toBe('new');
    });

    it('rung 1: non-empty input, clear not selected → sends the value (unchanged behavior)', () => {
      expect(buildConfigPayload(ntfyDef, state({ token: 'new' }, { token: true })).token).toBe('new');
    });

    it('rung 2: blank input + clear selected → emits the empty-string clear sentinel', () => {
      const payload = buildConfigPayload(ntfyDef, state({ token: '' }, { token: true }, { token: true }));
      expect(payload.token).toBe('');
    });

    it('rung 3: blank input + clear not selected → omits the field (keep stored)', () => {
      expect(buildConfigPayload(ntfyDef, state({ token: '' }, { token: true }))).not.toHaveProperty('token');
    });

    it('a REQUIRED secret never emits the clear sentinel — blank stays omitted even if clear is set', () => {
      // webhook `url` is the required secret; the UI never shows clear for it, but assert the
      // helper would not honor a stray clear flag regardless.
      const webhookDef = NOTIFIER_REGISTRY.webhook;
      const f: NotifierFormState = { ...newNotifierForm('webhook'), id: 'nf_1', fields: { url: '' }, has: { url: true }, clear: { url: true } };
      expect(buildConfigPayload(webhookDef, f)).not.toHaveProperty('url');
    });
  });

  it('a blank REQUIRED non-secret field emits an empty string (which the server min(1) rejects)', () => {
    // ntfy `topic` is required + non-secret: documents that buildConfigPayload sends ''
    // for it (settings-notifiers.ts collapses required text to its trimmed value).
    expect(buildConfigPayload(ntfyDef, state({ topic: '' })).topic).toBe('');
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

  it('test body samples the first selected event (single- and multi-event)', () => {
    // newNotifierForm selects all events in registry order → first is request.created.
    expect(buildNotifierTestBody(newNotifierForm('ntfy'), null)?.event).toBe('request.created');
    const pendingOnly: NotifierFormState = { ...newNotifierForm('ntfy'), events: ['user.pending'] };
    expect(buildNotifierTestBody(pendingOnly, null)?.event).toBe('user.pending');
    const both: NotifierFormState = { ...newNotifierForm('ntfy'), events: ['user.pending', 'request.created'] };
    expect(buildNotifierTestBody(both, null)?.event).toBe('user.pending');
  });

  it('returns null when no event is selected (nothing to sample)', () => {
    expect(buildNotifierTestBody({ ...newNotifierForm('ntfy'), events: [] }, null)).toBeNull();
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
