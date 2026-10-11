/* GNOME Settings Extensions panel; the embedded GJS controller fills its native navigation view. */
#include "config.h"
#include "shell/cc-panel.h"
#include <glib/gi18n.h>

typedef struct _CcExtensionsPanel { CcPanel parent; } CcExtensionsPanel;
typedef struct _CcExtensionsPanelClass { CcPanelClass parent_class; } CcExtensionsPanelClass;
GType cc_extensions_panel_get_type (void);
G_DEFINE_TYPE (CcExtensionsPanel, cc_extensions_panel, CC_TYPE_PANEL)

static void
cc_extensions_panel_class_init (CcExtensionsPanelClass *klass)
{
}

static void
cc_extensions_panel_init (CcExtensionsPanel *self)
{
  GtkWidget *loading = gtk_label_new (_("Loading Extensions…"));
  AdwNavigationPage *page = adw_navigation_page_new (loading, _("Extensions"));
  AdwNavigationView *navigation = ADW_NAVIGATION_VIEW (adw_navigation_page_get_child (ADW_NAVIGATION_PAGE (self)));
  gtk_widget_set_name (GTK_WIDGET (self), "monge-extensions-panel");
  adw_navigation_page_set_tag (page, "extensions-list");
  adw_navigation_view_add (navigation, page);
}
