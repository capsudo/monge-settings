import Gio from 'gi://Gio';

export function createExtensionViewState({ applicationId, schemaSource = Gio.SettingsSchemaSource.get_default() }) {
    if (!/^org\.(?:gnome\.Settings|monge\.Settings\.Development)$/.test(applicationId))
        throw new Error('Invalid Settings application identity');
    const schema = schemaSource.lookup('org.monge.Settings.Extensions', true);
    if (!schema) throw new Error('Extension view-state schema is missing; update the local development build');
    const settings = new Gio.Settings({ settings_schema: schema,
        path: `/${applicationId.replaceAll('.', '/')}/extensions/` });
    return {
        get() { return settings.get_string('last-view') === 'details' ? 'details' : 'preferences'; },
        set(value) {
            if (value !== 'details' && value !== 'preferences') return false;
            return settings.set_string('last-view', value);
        },
    };
}
