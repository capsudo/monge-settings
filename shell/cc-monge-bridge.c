/* load the extension-preferences JavaScript inside Settings so widgets keep the real Settings window as their root. */
#include "config.h"
#include "cc-monge-bridge.h"
#include <gjs/gjs.h>

void
cc_monge_bridge_start (GtkWindow *window)
{
  GtkApplication *application = gtk_window_get_application (window);
  GjsContext *context = g_object_get_data (G_OBJECT (application), "monge-gjs-context");
  g_autoptr(GError) error = NULL;
  g_autofree char *path = NULL;
  g_autofree char *uri = NULL;
  int status = 0;
  if (context)
    return;
  context = gjs_context_new ();
  g_object_set_data_full (G_OBJECT (application), "monge-gjs-context", context, g_object_unref);
  path = g_build_filename (MONGE_JS_DIR, "main.js", NULL);
  uri = g_filename_to_uri (path, NULL, &error);
  if (!uri || !gjs_context_register_module (context, "monge-settings", uri, &error) ||
      !gjs_context_eval (context,
        "import('monge-settings').catch(error => { logError(error); globalThis.mongeSettingsError = error; });",
        -1, "monge-settings-bootstrap", &status, &error))
    g_warning ("Could not load Extensions: %s", error ? error->message : "JavaScript startup failed");
}
