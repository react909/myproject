#define MyAppName "NurCRM Manablock"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "NurCRM"
#define MyAppExeName "NurCRM-Manablock.exe"

[Setup]
AppId={{AC47C7B7-4AB0-4E78-9D0B-293BB6F6F8CF}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\build\installer
OutputBaseFilename=NurCRM-Manablock-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительные задачи:"

[Files]
Source: "..\build\backend\backend.exe"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "..\desktop\dist-electron\win-unpacked\*"; DestDir: "{app}\frontend"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\frontend\{#MyAppExeName}"; IconFilename: "{app}\frontend\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\frontend\{#MyAppExeName}"; IconFilename: "{app}\frontend\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\backend\backend.exe"; Description: "Запустить backend в фоне"; Flags: runhidden nowait postinstall skipifsilent
Filename: "{app}\frontend\{#MyAppExeName}"; Description: "Запустить {#MyAppName}"; Flags: nowait postinstall skipifsilent
