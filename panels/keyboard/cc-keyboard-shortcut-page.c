/* cc-keyboard-shortcut-dialog.c
 *
 * Copyright (C) 2010 Intel, Inc
 * Copyright (C) 2016 Endless, Inc
 * Copyright (C) 2020 System76, Inc.
 * Copyright (C) 2022 Purism SPC
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, see <http://www.gnu.org/licenses/>.
 *
 * Author: Thomas Wood <thomas.wood@intel.com>
 *         Georges Basile Stavracas Neto <gbsneto@gnome.org>
 *         Ian Douglas Scott <idscott@system76.com>
 *         Mohammed Sadiq <sadiq@sadiqpk.org>
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#include <config.h>
#include <glib/gi18n.h>
#include <adwaita.h>

#include "cc-keyboard-shortcut-page.h"
#include "cc-keyboard-item.h"
#include "cc-keyboard-manager.h"
#include "cc-keyboard-shortcut-group.h"
#include "cc-util.h"
#include "keyboard-shortcuts.h"

#define OLD_ACTIVITIES_OVERVIEW_SHORTCUT "Super_L"
#define DEFAULT_ACTIVITIES_OVERVIEW_SHORTCUT "Super"

struct _CcKeyboardShortcutPage
{
  AdwBin                parent_instance;

  AdwPreferencesGroup  *overview_group;
  AdwPreferencesGroup  *reset_group;
  AdwSwitchRow         *overview_shortcut_row;
  AdwButtonRow         *reset_all_button_row;
  AdwDialog            *reset_all_dialog;
  GtkSearchEntry       *search_entry;
  GtkStack             *section_stack;
  AdwPreferencesPage   *search_result_page;
  AdwStatusPage        *empty_results_page;

  GtkSizeGroup         *accelerator_size_group;

  /* A GListStore of sections containing a GListStore of CcKeyboardItem */
  GListStore           *sections;
  GtkFlattenListModel  *filtered_shortcuts;

  CcKeyboardManager    *manager;
  GStrv                 search_terms;
 };

G_DEFINE_TYPE (CcKeyboardShortcutPage, cc_keyboard_shortcut_page, ADW_TYPE_BIN)


static GListStore *
keyboard_shortcut_get_section_store (CcKeyboardShortcutPage *self,
                                     const char               *section_id,
                                     const char               *section_title)
{
  g_autoptr(GListStore) section = NULL;
  GtkWidget *group;
  guint n_items;

  g_assert (CC_IS_KEYBOARD_SHORTCUT_PAGE (self));
  g_assert (section_id && *section_id);

  n_items = g_list_model_get_n_items (G_LIST_MODEL (self->sections));

  for (guint i = 0; i < n_items; i++)
    {
      g_autoptr(GObject) item = NULL;
      const char *item_section_id;

      item = g_list_model_get_item (G_LIST_MODEL (self->sections), i);
      item_section_id = g_object_get_data (item, "id");

      if (g_str_equal (item_section_id, section_id))
        return G_LIST_STORE (item);
    }

  /* Found no matching section, so create one */
  section = g_list_store_new (CC_TYPE_KEYBOARD_ITEM);
  g_object_set_data_full (G_OBJECT (section), "id", g_strdup (section_id), g_free);
  g_object_set_data_full (G_OBJECT (section), "title", g_strdup (section_title), g_free);

  /* This group shall be shown in the search results page */
  group = cc_keyboard_shortcut_group_new (G_LIST_MODEL (section),
                                          section_id, section_title,
                                          self->manager,
                                          self->accelerator_size_group);
  g_object_set_data (G_OBJECT (section), "search-group", group);

  g_list_store_append (self->sections, section);

  return section;
}

static void
shortcut_added_cb (CcKeyboardShortcutPage *self,
                   CcKeyboardItem           *item,
                   const char               *section_id,
                   const char               *section_title)
{
  GListStore *section;

  /* Global shortcuts sections are already presented in the apps panel.
   * _GVARIANT should never appear in this dialog, so filter it only out of
   * caution.
   */
  if (cc_keyboard_item_get_item_type (item) == CC_KEYBOARD_ITEM_TYPE_GLOBAL_SHORTCUT)
    return;

  section = keyboard_shortcut_get_section_store (self, section_id, section_title);
  g_object_set_data (G_OBJECT (item), "section", section);
  g_list_store_append (section, item);
}

static void
shortcut_removed_cb (CcKeyboardShortcutPage *self,
                     CcKeyboardItem           *item)
{
  GListStore *section;
  guint position;

  section = g_object_get_data (G_OBJECT (item), "section");
  g_return_if_fail (section);

  if (g_list_store_find (section, item, &position))
    g_list_store_remove (section, position);
}

static int
compare_sections_title (gconstpointer a,
                        gconstpointer b,
                        gpointer     user_data)
{
  GObject *obj_a, *obj_b;

  const char *title_a, *title_b, *id_a, *id_b;

  obj_a = G_OBJECT (a);
  obj_b = G_OBJECT (b);

  id_a = g_object_get_data (obj_a, "id");
  id_b = g_object_get_data (obj_b, "id");

  /* Always place custom row as the last item */
  if (g_str_equal (id_a, "custom"))
    return 1;

  if (g_str_equal (id_b, "custom"))
    return -1;

  title_a = _(g_object_get_data (obj_a, "title"));
  title_b = _(g_object_get_data (obj_b, "title"));

  return g_strcmp0 (title_a, title_b);
}

static void
shortcut_search_result_changed_cb (CcKeyboardShortcutPage *self)
{
  GListModel *model;
  GtkWidget *page;
  guint n_items;

  g_assert (CC_IS_KEYBOARD_SHORTCUT_PAGE (self));

  model = G_LIST_MODEL (self->filtered_shortcuts);
  n_items = g_list_model_get_n_items (model);

  if (n_items == 0)
    page = GTK_WIDGET (self->empty_results_page);
  else
    page = GTK_WIDGET (self->search_result_page);

  gtk_stack_set_visible_child (self->section_stack, page);
}

/* All items have loaded, now sort the groups and add them to the page */
static void
shortcuts_loaded_cb (CcKeyboardShortcutPage *self)
{
  g_autoptr(GPtrArray) filtered_items = NULL;
  g_autoptr(GPtrArray) widgets = NULL;
  GListStore *filtered_lists;
  guint n_items;

  /* Ensure that custom shorcuts section exists */
  keyboard_shortcut_get_section_store (self, "custom", "Custom Shortcuts");
  n_items = g_list_model_get_n_items (G_LIST_MODEL (self->sections));
  widgets = g_ptr_array_new ();
  filtered_items = g_ptr_array_new ();
  filtered_lists = g_list_store_new (G_TYPE_LIST_MODEL);

  g_list_store_sort (self->sections, compare_sections_title, NULL);

  for (guint i = 0; i < n_items; i++)
    {
      g_autoptr(GObject) item = NULL;
      CcKeyboardShortcutGroup *group;
      GListModel *model;

      item = g_list_model_get_item (G_LIST_MODEL (self->sections), i);
      group = g_object_get_data (item, "search-group");
      g_ptr_array_add (widgets, group);

      model = cc_keyboard_shortcut_group_get_model (group);
      g_ptr_array_add (filtered_items, model);
    }

  /* Populate search results page */
  for (guint i = 0; i < widgets->len; i++)
    adw_preferences_page_add (self->search_result_page, widgets->pdata[i]);

  adw_preferences_page_add (self->search_result_page, self->overview_group);
  adw_preferences_page_add (self->search_result_page, self->reset_group);

  /* Keep track of search results so as to update empty state */
  g_list_store_splice (filtered_lists, 0, 0, filtered_items->pdata, filtered_items->len);
  self->filtered_shortcuts = gtk_flatten_list_model_new (G_LIST_MODEL (filtered_lists));

  g_signal_connect_object (self->filtered_shortcuts, "items-changed",
                           G_CALLBACK (shortcut_search_result_changed_cb),
                           self, G_CONNECT_SWAPPED);
}

static void
on_reset_all_dialog_response_cb (CcKeyboardShortcutPage *self)
{
  guint n_items, j_items;

  n_items = g_list_model_get_n_items (G_LIST_MODEL (self->sections));

  for (guint i = 0; i < n_items; i++)
    {
      g_autoptr(GListModel) section = NULL;

      section = g_list_model_get_item (G_LIST_MODEL (self->sections), i);
      j_items = g_list_model_get_n_items (section);

      for (guint j = 0; j < j_items; j++)
        {
          g_autoptr(CcKeyboardItem) item = NULL;

          item = g_list_model_get_item (section, j);

          /* Don't reset custom shortcuts */
          if (cc_keyboard_item_get_item_type (item) == CC_KEYBOARD_ITEM_TYPE_GSETTINGS_PATH)
            return;

          /* cc_keyboard_manager_reset_shortcut() already resets conflicting shortcuts,
           * so no other check is needed here. */
          cc_keyboard_manager_reset_shortcut (self->manager, item);
        }
    }

  adw_switch_row_set_active (self->overview_shortcut_row, TRUE);
}

static void
shortcut_search_entry_changed_cb (CcKeyboardShortcutPage *self)
{
  g_autofree char *search = NULL;
  const char *search_text;
  guint n_items;

  g_assert (CC_IS_KEYBOARD_SHORTCUT_PAGE (self));

  n_items = g_list_model_get_n_items (G_LIST_MODEL (self->sections));
  search_text = gtk_editable_get_text (GTK_EDITABLE (self->search_entry));
  search = cc_util_normalize_casefold_and_unaccent (search_text);

  g_clear_pointer (&self->search_terms, g_strfreev);
  if (search && *search && *search != ' ')
    self->search_terms = g_strsplit (search, " ", -1);

  /* "Reset all..." button row should be sensitive only if the search is not active */
  gtk_widget_set_sensitive (GTK_WIDGET (self->reset_all_button_row), !self->search_terms);
  gtk_widget_set_visible (GTK_WIDGET (self->overview_group), !self->search_terms);
  gtk_widget_set_visible (GTK_WIDGET (self->reset_group), !self->search_terms);

  for (guint i = 0; i < n_items; i++)
    {
      g_autoptr(GObject) item = NULL;
      CcKeyboardShortcutGroup *group;

      item = g_list_model_get_item (G_LIST_MODEL (self->sections), i);
      group = g_object_get_data (item, "search-group");

      cc_keyboard_shortcut_group_set_filter (group, self->search_terms);
    }

  shortcut_search_result_changed_cb (self);
}

static void
shortcut_search_entry_stopped_cb (CcKeyboardShortcutPage *self)
{
  const char *search_text;
  search_text = gtk_editable_get_text (GTK_EDITABLE (self->search_entry));

  if (search_text && g_strcmp0 (search_text, "") != 0)
    gtk_editable_set_text (GTK_EDITABLE (self->search_entry), "");
}

static gboolean
get_overview_shortcut_setting (GValue   *value,
                               GVariant *variant,
                               gpointer  user_data)
{
  const char *overlay_key = g_variant_get_string (variant, NULL);
  gboolean enabled = g_strcmp0 (overlay_key, DEFAULT_ACTIVITIES_OVERVIEW_SHORTCUT) == 0 ||
                     g_strcmp0 (overlay_key, OLD_ACTIVITIES_OVERVIEW_SHORTCUT) == 0;
  g_value_set_boolean (value, enabled);

  return TRUE;
}

static GVariant *
set_overview_shortcut_setting (const GValue       *value,
                               const GVariantType *variant,
                               gpointer            user_data)
{
  gboolean enabled = g_value_get_boolean (value);

  return g_variant_new_string (enabled ? DEFAULT_ACTIVITIES_OVERVIEW_SHORTCUT : "");
}

static void
cc_keyboard_shortcut_page_finalize (GObject *object)
{
  CcKeyboardShortcutPage *self = CC_KEYBOARD_SHORTCUT_PAGE (object);

  g_clear_object (&self->manager);
  g_clear_object (&self->sections);
  g_clear_pointer (&self->search_terms, g_strfreev);
  g_clear_object (&self->sections);
  g_clear_object (&self->filtered_shortcuts);

  G_OBJECT_CLASS (cc_keyboard_shortcut_page_parent_class)->finalize (object);
}

static void
cc_keyboard_shortcut_page_class_init (CcKeyboardShortcutPageClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  GtkWidgetClass *widget_class = GTK_WIDGET_CLASS (klass);

  object_class->finalize = cc_keyboard_shortcut_page_finalize;

  gtk_widget_class_set_template_from_resource (widget_class,
                                               "/org/gnome/control-center/"
                                               "keyboard/cc-keyboard-shortcut-page.ui");

  gtk_widget_class_bind_template_child (widget_class, CcKeyboardShortcutPage, overview_group);
  gtk_widget_class_bind_template_child (widget_class, CcKeyboardShortcutPage, reset_group);
  gtk_widget_class_bind_template_child (widget_class, CcKeyboardShortcutPage, overview_shortcut_row);
  gtk_widget_class_bind_template_child (widget_class, CcKeyboardShortcutPage, reset_all_button_row);
  gtk_widget_class_bind_template_child (widget_class, CcKeyboardShortcutPage, reset_all_dialog);
  gtk_widget_class_bind_template_child (widget_class, CcKeyboardShortcutPage, search_entry);
  gtk_widget_class_bind_template_child (widget_class, CcKeyboardShortcutPage, section_stack);
  gtk_widget_class_bind_template_child (widget_class, CcKeyboardShortcutPage, search_result_page);
  gtk_widget_class_bind_template_child (widget_class, CcKeyboardShortcutPage, empty_results_page);
  gtk_widget_class_bind_template_child (widget_class, CcKeyboardShortcutPage, accelerator_size_group);

  gtk_widget_class_bind_template_callback (widget_class, on_reset_all_dialog_response_cb);
  gtk_widget_class_bind_template_callback (widget_class, shortcut_search_entry_changed_cb);
  gtk_widget_class_bind_template_callback (widget_class, shortcut_search_entry_stopped_cb);
}

static void
cc_keyboard_shortcut_page_init (CcKeyboardShortcutPage *self)
{
  g_autoptr(GSettings) mutter_settings = g_settings_new ("org.gnome.mutter");

  gtk_widget_init_template (GTK_WIDGET (self));

  self->manager = cc_keyboard_manager_new ();

  self->sections = g_list_store_new (G_TYPE_LIST_STORE);

  g_signal_connect_object (self->manager,
                           "shortcut-added",
                           G_CALLBACK (shortcut_added_cb),
                           self, G_CONNECT_SWAPPED);
  g_signal_connect_object (self->manager,
                           "shortcut-removed",
                           G_CALLBACK (shortcut_removed_cb),
                           self, G_CONNECT_SWAPPED);
  g_signal_connect_object (self->manager,
                           "shortcuts-loaded",
                           G_CALLBACK (shortcuts_loaded_cb),
                           self, G_CONNECT_SWAPPED);

  cc_keyboard_manager_load_shortcuts (self->manager);

  g_settings_bind_with_mapping (mutter_settings, "overlay-key",
                                self->overview_shortcut_row, "active",
				G_SETTINGS_BIND_DEFAULT,
				get_overview_shortcut_setting,
				set_overview_shortcut_setting,
				NULL, NULL);
}

CcKeyboardShortcutPage*
cc_keyboard_shortcut_page_new (void)
{
  return g_object_new (CC_TYPE_KEYBOARD_SHORTCUT_PAGE, NULL);
}
