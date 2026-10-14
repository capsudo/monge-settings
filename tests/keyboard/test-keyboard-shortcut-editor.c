/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "config.h"
#include "cc-keyboard-shortcut-editor.c"
#include "cc-keyboard-shortcut-row.h"
#include "cc-keyboard-resources.h"

static CcKeyboardItem *
new_screenshot_item (void)
{
  const char *bindings[] = { "<Shift><Super>s", "Print", NULL };
  CcKeyboardItem *item = cc_keyboard_item_new (CC_KEYBOARD_ITEM_TYPE_GSETTINGS);

  cc_keyboard_item_load_from_gsettings (item, "Take a screenshot interactively",
                                       "org.gnome.shell.keybindings", "show-screenshot-ui");
  g_settings_set_strv (cc_keyboard_item_get_settings (item), "show-screenshot-ui", bindings);
  return item;
}

static void
assert_bindings (CcKeyboardItem *item,
                 const char    *first,
                 const char    *second,
                 const char    *third)
{
  g_auto(GStrv) bindings = g_settings_get_strv (cc_keyboard_item_get_settings (item),
                                               cc_keyboard_item_get_key (item));
  const char *expected[] = { first, second, third, NULL };
  g_autofree char *actual_text = g_strjoinv (", ", bindings);

  g_test_message ("Stored bindings: [%s]", actual_text);
  g_assert_cmpstrv (bindings, expected);
}

static void
test_row_shows_all_bindings (void)
{
  g_autoptr(CcKeyboardItem) item = new_screenshot_item ();
  g_autoptr(CcKeyboardManager) manager = cc_keyboard_manager_new ();
  g_autoptr(GtkSizeGroup) size_group = gtk_size_group_new (GTK_SIZE_GROUP_HORIZONTAL);
  g_autoptr(CcKeyboardShortcutRow) row = g_object_ref_sink (cc_keyboard_shortcut_row_new (item, manager, size_group));
  GtkLabel *label = GTK_LABEL (gtk_widget_get_template_child (GTK_WIDGET (row),
                                                             CC_TYPE_KEYBOARD_SHORTCUT_ROW,
                                                             "accelerator_label"));
  GList *combos = cc_keyboard_item_get_key_combos (item);
  g_autofree char *first = convert_keysym_state_to_string (combos->data);
  g_autofree char *second = convert_keysym_state_to_string (combos->next->data);
  g_autofree char *expected = g_strjoin (", ", first, second, NULL);

  g_assert_cmpstr (gtk_label_get_text (label), ==, expected);
  g_assert_cmpstr (gtk_widget_get_tooltip_text (GTK_WIDGET (label)), ==, expected);
  g_assert_true (gtk_label_get_single_line_mode (label));
  g_assert_cmpint (gtk_label_get_ellipsize (label), ==, PANGO_ELLIPSIZE_END);
  g_assert_cmpint (gtk_label_get_max_width_chars (label), >, 0);
  {
    CcKeyCombo combo = { 0, 0, 0 };
    g_autofree char *third = NULL;
    g_autofree char *all = NULL;

    gtk_accelerator_parse ("<Control><Alt>p", &combo.keyval, &combo.mask);
    cc_keyboard_item_add_key_combo (item, &combo);
    third = convert_keysym_state_to_string (&combo);
    all = g_strjoin (", ", first, second, third, NULL);
    g_assert_cmpstr (gtk_label_get_text (label), ==, all);
    g_assert_cmpstr (gtk_widget_get_tooltip_text (GTK_WIDGET (label)), ==, all);
  }
  cc_keyboard_item_disable (item);
  g_assert_cmpstr (gtk_label_get_text (label), ==, "Disabled");
}

static void
test_editor_shows_all_bindings (void)
{
  g_autoptr(CcKeyboardItem) item = new_screenshot_item ();
  g_autoptr(CcKeyboardManager) manager = cc_keyboard_manager_new ();
  g_autoptr(CcKeyboardShortcutEditor) editor = g_object_ref_sink (cc_keyboard_shortcut_editor_new (manager));
  GtkListBox *list;

  cc_keyboard_shortcut_editor_set_item (editor, item);
  list = GTK_LIST_BOX (gtk_widget_get_template_child (GTK_WIDGET (editor),
                                                     CC_TYPE_KEYBOARD_SHORTCUT_EDITOR,
                                                     "bindings_list"));
  g_assert_nonnull (list);
  g_assert_nonnull (gtk_list_box_get_row_at_index (list, 0));
  g_assert_nonnull (gtk_list_box_get_row_at_index (list, 1));
  g_assert_nonnull (gtk_list_box_get_row_at_index (list, 2));
  g_assert_null (g_object_get_data (G_OBJECT (gtk_list_box_get_row_at_index (list, 2)), "combo"));
  g_assert_null (gtk_list_box_get_row_at_index (list, 3));
  assert_bindings (item, "<Shift><Super>s", "Print", NULL);
}

static void
test_edit_preserves_other_bindings (void)
{
  g_autoptr(CcKeyboardItem) item = new_screenshot_item ();
  g_autoptr(CcKeyboardManager) manager = cc_keyboard_manager_new ();
  g_autoptr(CcKeyboardShortcutEditor) editor = g_object_ref_sink (cc_keyboard_shortcut_editor_new (manager));

  cc_keyboard_shortcut_editor_set_item (editor, item);
  gtk_accelerator_parse ("<Control><Alt>p", &editor->custom_combo->keyval, &editor->custom_combo->mask);
  editor->custom_combo->keycode = 0;
  editor->edited = TRUE;
  apply_custom_item_fields (editor, item);
  assert_bindings (item, "Print", "<Control><Alt>p", NULL);
}

static void
test_search_secondary_binding (void)
{
  g_autoptr(CcKeyboardItem) item = new_screenshot_item ();
  char *terms[] = { "print", NULL };

  g_assert_true (cc_keyboard_item_matches_string (item, terms));
}

static void
test_replace_preserves_conflicting_alternatives (void)
{
  g_autoptr(CcKeyboardItem) item = new_screenshot_item ();
  g_autoptr(CcKeyboardItem) other = cc_keyboard_item_new (CC_KEYBOARD_ITEM_TYPE_GSETTINGS);
  g_autoptr(CcKeyboardManager) manager = cc_keyboard_manager_new ();
  g_autoptr(CcKeyboardShortcutEditor) editor = g_object_ref_sink (cc_keyboard_shortcut_editor_new (manager));
  const char *bindings[] = { "<Control><Alt>p", "<Control><Alt>q", NULL };

  cc_keyboard_item_load_from_gsettings (other, "Take a screenshot", "org.gnome.shell.keybindings", "screenshot");
  g_settings_set_strv (cc_keyboard_item_get_settings (other), "screenshot", bindings);
  cc_keyboard_shortcut_editor_set_item (editor, item);
  gtk_accelerator_parse (bindings[0], &editor->custom_combo->keyval, &editor->custom_combo->mask);
  editor->custom_combo->keycode = 0;
  editor->edited = TRUE;
  editor->collision_item = other;
  set_button_clicked_cb (editor);
  assert_bindings (other, "<Control><Alt>q", NULL, NULL);
  assert_bindings (item, "Print", "<Control><Alt>p", NULL);
}

static void
test_remove_global_binding (void)
{
  g_autoptr(CcKeyboardItem) item = cc_keyboard_item_new (CC_KEYBOARD_ITEM_TYPE_GLOBAL_SHORTCUT);
  g_autoptr(GVariant) properties = g_variant_ref_sink (g_variant_new_parsed (
    "{'description': <'Global'>, 'shortcuts': <['<Control>p', '<Control>q']>}"));
  CcKeyCombo combo;

  cc_keyboard_item_load_from_global_shortcuts (item, "test", properties);
  combo = cc_keyboard_item_get_primary_combo (item);
  cc_keyboard_item_remove_key_combo (item, &combo);
  g_assert_cmpuint (g_list_length (cc_keyboard_item_get_key_combos (item)), ==, 1);
  g_assert_cmpuint (cc_keyboard_item_get_primary_combo (item).keyval, ==, GDK_KEY_q);
}

static void
settle_widgets (void)
{
  for (guint i = 0; i < 30; i++)
    {
      while (g_main_context_iteration (NULL, FALSE));
      g_usleep (10000);
    }
}

static void
save_screenshot (GtkWindow  *window,
                 const char *name)
{
  const char *directory = g_getenv ("MONGE_SCREENSHOT_DIR");
  g_autoptr(GdkPaintable) paintable = NULL;
  g_autoptr(GtkSnapshot) snapshot = NULL;
  g_autoptr(GskRenderNode) node = NULL;
  g_autoptr(GdkTexture) texture = NULL;
  g_autofree char *path = NULL;

  if (!directory)
    return;
  settle_widgets ();
  paintable = gtk_widget_paintable_new (GTK_WIDGET (window));
  snapshot = gtk_snapshot_new ();
  gdk_paintable_snapshot (paintable, GDK_SNAPSHOT (snapshot),
                          gtk_widget_get_width (GTK_WIDGET (window)),
                          gtk_widget_get_height (GTK_WIDGET (window)));
  node = gtk_snapshot_free_to_node (g_steal_pointer (&snapshot));
  g_assert_nonnull (node);
  texture = gsk_renderer_render_texture (gtk_native_get_renderer (GTK_NATIVE (window)), node, NULL);
  path = g_build_filename (directory, name, NULL);
  g_assert_true (gdk_texture_save_to_png (texture, path));
}

static GtkWidget *
find_button (GtkWidget *widget)
{
  if (GTK_IS_BUTTON (widget))
    return widget;
  for (GtkWidget *child = gtk_widget_get_first_child (widget); child; child = gtk_widget_get_next_sibling (child))
    {
      GtkWidget *button = find_button (child);
      if (button)
        return button;
    }
  return NULL;
}

static GtkWidget *
find_edit_icon (GtkWidget *widget)
{
  if (GTK_IS_IMAGE (widget) &&
      g_strcmp0 (gtk_image_get_icon_name (GTK_IMAGE (widget)), "document-edit-symbolic") == 0)
    return widget;
  for (GtkWidget *child = gtk_widget_get_first_child (widget); child; child = gtk_widget_get_next_sibling (child))
    {
      GtkWidget *icon = find_edit_icon (child);
      if (icon)
        return icon;
    }
  return NULL;
}

static void
set_pending_binding (CcKeyboardShortcutEditor *editor,
                     const char               *accelerator)
{
  gtk_accelerator_parse (accelerator, &editor->custom_combo->keyval, &editor->custom_combo->mask);
  editor->custom_combo->keycode = 0;
  editor->custom_is_modifier = FALSE;
  setup_custom_shortcut (editor);
}

static void
activate_add_row (CcKeyboardShortcutEditor *editor)
{
  GtkListBoxRow *row = gtk_list_box_get_row_at_index (editor->bindings_list,
                                                     g_list_length (cc_keyboard_item_get_key_combos (editor->item)));

  g_assert_nonnull (row);
  g_assert_null (g_object_get_data (G_OBJECT (row), "combo"));
  g_signal_emit_by_name (editor->bindings_list, "row-activated", row);
  g_assert_false (gtk_widget_get_visible (GTK_WIDGET (editor->remove_button)));
}

static void
test_gui_binding_lifecycle (void)
{
  g_autoptr(CcKeyboardItem) item = new_screenshot_item ();
  g_autoptr(CcKeyboardManager) manager = cc_keyboard_manager_new ();
  g_autoptr(CcKeyboardShortcutEditor) editor = g_object_ref_sink (cc_keyboard_shortcut_editor_new (manager));
  g_autoptr(GtkSizeGroup) size_group = gtk_size_group_new (GTK_SIZE_GROUP_HORIZONTAL);
  g_autoptr(GtkWindow) window = g_object_ref_sink (GTK_WINDOW (adw_window_new ()));
  GtkWidget *group = adw_preferences_group_new ();
  CcKeyboardShortcutRow *row = cc_keyboard_shortcut_row_new (item, manager, size_group);
  GtkListBoxRow *binding_row;

  gtk_window_set_default_size (window, 650, 420);
  gtk_widget_set_margin_start (group, 24);
  gtk_widget_set_margin_end (group, 24);
  gtk_widget_set_margin_top (group, 24);
  adw_preferences_group_set_title (ADW_PREFERENCES_GROUP (group), "Screenshots");
  adw_preferences_group_add (ADW_PREFERENCES_GROUP (group), GTK_WIDGET (row));
  adw_window_set_content (ADW_WINDOW (window), group);
  gtk_window_present (window);
  settle_widgets ();
  save_screenshot (window, "keyboard-multiple-shortcuts.png");

  cc_keyboard_shortcut_editor_set_item (editor, item);
  adw_dialog_present (ADW_DIALOG (editor), GTK_WIDGET (window));
  settle_widgets ();
  g_assert_cmpint (get_shortcut_editor_page (editor), ==, PAGE_BINDINGS);
  save_screenshot (window, "keyboard-multiple-shortcuts-editor.png");

  activate_add_row (editor);
  set_pending_binding (editor, "<Control><Alt>p");
  g_signal_emit_by_name (editor->set_button, "clicked");
  assert_bindings (item, "<Shift><Super>s", "Print", "<Control><Alt>p");
  g_assert_nonnull (gtk_list_box_get_row_at_index (editor->bindings_list, 2));

  binding_row = gtk_list_box_get_row_at_index (editor->bindings_list, 1);
  g_signal_emit_by_name (editor->bindings_list, "row-activated", binding_row);
  set_pending_binding (editor, "<Control><Alt>q");
  g_signal_emit_by_name (editor->set_button, "clicked");
  assert_bindings (item, "<Shift><Super>s", "<Control><Alt>p", "<Control><Alt>q");

  activate_add_row (editor);
  set_pending_binding (editor, "<Control><Alt>r");
  g_signal_emit_by_name (editor->cancel_button, "clicked");
  assert_bindings (item, "<Shift><Super>s", "<Control><Alt>p", "<Control><Alt>q");

  binding_row = gtk_list_box_get_row_at_index (editor->bindings_list, 1);
  g_signal_emit_by_name (editor->bindings_list, "row-activated", binding_row);
  memset (editor->custom_combo, 0, sizeof (CcKeyCombo));
  setup_custom_shortcut (editor);
  g_signal_emit_by_name (editor->set_button, "clicked");
  assert_bindings (item, "<Shift><Super>s", "<Control><Alt>q", NULL);

  binding_row = gtk_list_box_get_row_at_index (editor->bindings_list, 1);
  g_signal_emit_by_name (editor->bindings_list, "row-activated", binding_row);
  g_signal_emit_by_name (editor->remove_button, "clicked");
  assert_bindings (item, "<Shift><Super>s", NULL, NULL);

  g_signal_emit_by_name (editor->reset_bindings_button, "clicked");
  g_assert_true (cc_keyboard_item_is_value_default (item));
  g_assert_cmpint (get_shortcut_editor_page (editor), ==, PAGE_BINDINGS);
  g_assert_false (gtk_widget_get_visible (GTK_WIDGET (editor->reset_bindings_button)));

  cc_keyboard_item_disable (item);
  g_assert_cmpint (get_shortcut_editor_page (editor), ==, PAGE_EDIT);
  set_pending_binding (editor, "<Control><Alt>p");
  g_signal_emit_by_name (editor->set_button, "clicked");
  assert_bindings (item, "<Control><Alt>p", NULL, NULL);

  activate_add_row (editor);
  set_pending_binding (editor, "<Control><Alt>p");
  g_signal_emit_by_name (editor->set_button, "clicked");
  assert_bindings (item, "<Control><Alt>p", NULL, NULL);

  activate_add_row (editor);
  set_pending_binding (editor, "<Control><Alt>r");
  cc_keyboard_shortcut_editor_closed (editor);
  assert_bindings (item, "<Control><Alt>p", NULL, NULL);
  gtk_window_destroy (window);
}

static void
test_click_opens_editor_before_removal (void)
{
  g_autoptr(CcKeyboardItem) item = new_screenshot_item ();
  g_autoptr(CcKeyboardManager) manager = cc_keyboard_manager_new ();
  g_autoptr(CcKeyboardShortcutEditor) editor = g_object_ref_sink (cc_keyboard_shortcut_editor_new (manager));
  g_autoptr(GtkWindow) window = g_object_ref_sink (GTK_WINDOW (adw_window_new ()));
  GtkListBoxRow *row;

  gtk_window_set_default_size (window, 650, 420);
  gtk_window_present (window);
  cc_keyboard_shortcut_editor_set_item (editor, item);
  adw_dialog_present (ADW_DIALOG (editor), GTK_WIDGET (window));
  settle_widgets ();
  row = gtk_list_box_get_row_at_index (editor->bindings_list, 1);
  g_signal_emit_by_name (editor->bindings_list, "row-activated", row);
  assert_bindings (item, "<Shift><Super>s", "Print", NULL);
  g_assert_cmpint (get_shortcut_editor_page (editor), ==, PAGE_EDIT);
  g_assert_true (gtk_widget_get_visible (GTK_WIDGET (editor->remove_button)));
  g_assert_cmpuint (editor->original_combo.keyval, ==, GDK_KEY_Print);
  g_signal_emit_by_name (editor->cancel_button, "clicked");
  assert_bindings (item, "<Shift><Super>s", "Print", NULL);
  row = gtk_list_box_get_row_at_index (editor->bindings_list, 1);
  g_assert_null (find_button (GTK_WIDGET (row)));
  g_assert_nonnull (find_edit_icon (GTK_WIDGET (row)));
  g_assert_false (gtk_widget_get_can_target (find_edit_icon (GTK_WIDGET (row))));
  g_signal_emit_by_name (editor->bindings_list, "row-activated", row);
  save_screenshot (window, "keyboard-existing-shortcut-editor.png");
  set_pending_binding (editor, "<Control><Alt>p");
  g_assert_true (gtk_widget_get_visible (GTK_WIDGET (editor->remove_button)));
  g_signal_emit_by_name (editor->remove_button, "clicked");
  assert_bindings (item, "<Shift><Super>s", NULL, NULL);
  g_assert_cmpint (get_shortcut_editor_page (editor), ==, PAGE_BINDINGS);
  settle_widgets ();
  {
    GtkWidget *scrolled = gtk_widget_get_ancestor (GTK_WIDGET (editor->bindings_list), GTK_TYPE_SCROLLED_WINDOW);
    int natural_height;

    gtk_widget_measure (GTK_WIDGET (editor->bindings_list), GTK_ORIENTATION_VERTICAL, -1,
                        NULL, &natural_height, NULL, NULL);
    g_test_message ("Single binding: viewport=%d, natural list=%d", gtk_widget_get_height (scrolled), natural_height);
    g_assert_cmpint (gtk_widget_get_height (scrolled), <=, natural_height);
  }
  save_screenshot (window, "keyboard-single-shortcut-editor.png");
  row = gtk_list_box_get_row_at_index (editor->bindings_list, 0);
  g_signal_emit_by_name (editor->bindings_list, "row-activated", row);
  g_signal_emit_by_name (editor->remove_button, "clicked");
  assert_bindings (item, NULL, NULL, NULL);
  g_assert_cmpint (get_shortcut_editor_page (editor), ==, PAGE_EDIT);
  save_screenshot (window, "keyboard-empty-shortcut-editor.png");
  g_signal_emit_by_name (editor->cancel_button, "clicked");
  g_assert_null (cc_keyboard_shortcut_editor_get_item (editor));
  gtk_window_destroy (window);
}

static void
test_empty_shortcut_opens_capture (void)
{
  g_autoptr(CcKeyboardItem) item = new_screenshot_item ();
  g_autoptr(CcKeyboardManager) manager = cc_keyboard_manager_new ();
  g_autoptr(CcKeyboardShortcutEditor) editor = g_object_ref_sink (cc_keyboard_shortcut_editor_new (manager));

  cc_keyboard_item_disable (item);
  cc_keyboard_shortcut_editor_set_item (editor, item);
  g_assert_cmpint (get_shortcut_editor_page (editor), ==, PAGE_EDIT);
  g_assert_false (gtk_widget_get_child_visible (GTK_WIDGET (editor->bindings_box)));
}

static void
test_list_uses_natural_height (void)
{
  g_autoptr(CcKeyboardItem) item = new_screenshot_item ();
  g_autoptr(CcKeyboardManager) manager = cc_keyboard_manager_new ();
  g_autoptr(CcKeyboardShortcutEditor) editor = g_object_ref_sink (cc_keyboard_shortcut_editor_new (manager));
  GtkScrolledWindow *scrolled;

  cc_keyboard_shortcut_editor_set_item (editor, item);
  scrolled = GTK_SCROLLED_WINDOW (gtk_widget_get_ancestor (GTK_WIDGET (editor->bindings_list), GTK_TYPE_SCROLLED_WINDOW));
  g_assert_true (gtk_scrolled_window_get_propagate_natural_height (scrolled));
  g_assert_cmpint (gtk_scrolled_window_get_min_content_height (scrolled), ==, -1);
  g_assert_true (adw_dialog_get_follows_content_size (ADW_DIALOG (editor)));
}

static void
test_custom_shortcut_stays_single (void)
{
  g_autoptr(CcKeyboardItem) item = cc_keyboard_item_new (CC_KEYBOARD_ITEM_TYPE_GSETTINGS_PATH);
  g_autoptr(CcKeyboardManager) manager = cc_keyboard_manager_new ();
  g_autoptr(CcKeyboardShortcutEditor) editor = g_object_ref_sink (cc_keyboard_shortcut_editor_new (manager));
  g_autofree char *binding = NULL;

  cc_keyboard_item_load_from_gsettings_path (item, "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/test/", TRUE);
  cc_keyboard_shortcut_editor_set_item (editor, item);
  g_assert_cmpint (get_shortcut_editor_page (editor), ==, PAGE_CUSTOM);
  gtk_accelerator_parse ("<Control><Alt>p", &editor->custom_combo->keyval, &editor->custom_combo->mask);
  editor->edited = TRUE;
  apply_custom_item_fields (editor, item);
  binding = g_settings_get_string (cc_keyboard_item_get_settings (item), "binding");
  g_assert_cmpstr (binding, ==, "<Control><Alt>p");
}

int
main (int argc, char **argv)
{
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("LC_ALL", "C", TRUE);
  gtk_test_init (&argc, &argv, NULL);
  adw_init ();
  adw_style_manager_set_color_scheme (adw_style_manager_get_default (), ADW_COLOR_SCHEME_FORCE_DARK);
  g_assert_nonnull (cc_keyboard_get_resource ());

  g_test_add_func ("/keyboard/row/all-bindings", test_row_shows_all_bindings);
  g_test_add_func ("/keyboard/editor/all-bindings", test_editor_shows_all_bindings);
  g_test_add_func ("/keyboard/editor/edit-preserves-others", test_edit_preserves_other_bindings);
  g_test_add_func ("/keyboard/search/secondary-binding", test_search_secondary_binding);
  g_test_add_func ("/keyboard/editor/conflict-preserves-others", test_replace_preserves_conflicting_alternatives);
  g_test_add_func ("/keyboard/global/remove-binding", test_remove_global_binding);
  g_test_add_func ("/keyboard/editor/gui-lifecycle", test_gui_binding_lifecycle);
  g_test_add_func ("/keyboard/editor/custom-stays-single", test_custom_shortcut_stays_single);
  g_test_add_func ("/keyboard/editor/empty-opens-capture", test_empty_shortcut_opens_capture);
  g_test_add_func ("/keyboard/editor/natural-list-height", test_list_uses_natural_height);
  g_test_add_func ("/keyboard/editor/click-opens-editor", test_click_opens_editor_before_removal);
  return g_test_run ();
}
