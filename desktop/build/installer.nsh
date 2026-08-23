; Обновить кэш иконок Windows после установки (ярлык на рабочем столе).
!macro customFinish
  ; Обновить кэш иконок Windows после установки
  System::Call 'shell32::SHChangeNotify(i, i, i, i) (0x08000000, 0, 0, 0)'
!macroend