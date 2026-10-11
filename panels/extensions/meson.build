panels_list += cappletname
install_data('gnome-extensions-panel.desktop.in',
  rename: 'gnome-extensions-panel.desktop', install_dir: control_center_desktopdir)
panels_libs += static_library(cappletname,
  sources: 'cc-extensions-panel.c',
  include_directories: [top_inc, common_inc], dependencies: common_deps, c_args: cflags)
