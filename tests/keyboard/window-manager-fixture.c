/* SPDX-License-Identifier: GPL-3.0-or-later */
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <stdio.h>
#include <string.h>

int
main (void)
{
  Display *display = XOpenDisplay (NULL);
  Window root, window;
  Atom wm_check, wm_name, wm_keybindings, utf8;
  const char *name = "GNOME Shell";
  const char *keybindings = "Mutter,GNOME Shell";

  if (!display)
    {
      fputs ("Could not open the isolated X11 display\n", stderr);
      return 1;
    }

  root = DefaultRootWindow (display);
  window = XCreateSimpleWindow (display, root, 0, 0, 1, 1, 0, 0, 0);
  wm_check = XInternAtom (display, "_NET_SUPPORTING_WM_CHECK", False);
  wm_name = XInternAtom (display, "_NET_WM_NAME", False);
  wm_keybindings = XInternAtom (display, "_GNOME_WM_KEYBINDINGS", False);
  utf8 = XInternAtom (display, "UTF8_STRING", False);

  XChangeProperty (display, root, wm_check, XA_WINDOW, 32, PropModeReplace,
                   (unsigned char *) &window, 1);
  XChangeProperty (display, window, wm_check, XA_WINDOW, 32, PropModeReplace,
                   (unsigned char *) &window, 1);
  XChangeProperty (display, window, wm_name, utf8, 8, PropModeReplace,
                   (const unsigned char *) name, strlen (name));
  XChangeProperty (display, window, wm_keybindings, utf8, 8, PropModeReplace,
                   (const unsigned char *) keybindings, strlen (keybindings));
  XSetCloseDownMode (display, RetainTemporary);
  XCloseDisplay (display);
  return 0;
}
