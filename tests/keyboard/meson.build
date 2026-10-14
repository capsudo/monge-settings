if setxkbmap.found() and Xvfb.found()
  test_units = [
    'test-keyboard-shortcuts'
  ]

  env = [
    'G_MESSAGES_DEBUG=all',
            'BUILDDIR=' + meson.current_build_dir(),
        'TOP_BUILDDIR=' + meson.project_build_root(),
  # Disable ATK, this should not be required but it caused CI failures -- 2018-12-07
        'NO_AT_BRIDGE=1'
  ]
  cflags = [
    '-DTEST_SRCDIR="@0@"'.format(meson.current_source_dir())
  ]
  includes = [top_inc, include_directories('../../panels/keyboard')]

  foreach unit: test_units
    exe = executable(
                      unit,
             [unit + '.c'],
             dependencies : common_deps,
      include_directories : includes,
                link_with : [keyboard_panel_lib],
                   c_args : cflags
    )
  endforeach

  test(
    'test-keyboard',
    find_program('test-keyboard.py'),
        env : env,
    timeout : 60
  )
endif

if Xvfb.found()
  editor_deps = common_deps + [keyboard_panel_dep, keyboard_shortcuts_dep, libwidgets_dep]
  if have_x11_support
    editor_deps += x11_dep
  endif
  editor_test = executable(
    'test-keyboard-shortcut-editor',
    'test-keyboard-shortcut-editor.c',
    include_directories: [top_inc, common_inc],
    dependencies: editor_deps,
  )
  test(
    'test-keyboard-shortcut-editor',
    find_program('bash'),
    args: [meson.project_source_root() / 'scripts/isolated.sh', editor_test],
    timeout: 60,
  )
endif
