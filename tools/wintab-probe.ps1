# Loads Wintab32.dll (pen-tablet driver API) the way UE's StylusInputWintab does and prints OK / FAILED, error <code>.
# Used by tools/unreal-check.mjs: error 1114 (the driver's DllMain fails, e.g. its TabletService is not running) crashes the
# UE editor right after startup. No Wintab32.dll at all prints error 126 and is harmless.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WtProbe {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr LoadLibraryW(string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool FreeLibrary(IntPtr h);
}
"@
$h = [WtProbe]::LoadLibraryW("Wintab32.dll")
$err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
if ($h -eq [IntPtr]::Zero) { "LoadLibrary FAILED, error $err" } else { "LoadLibrary OK"; [void][WtProbe]::FreeLibrary($h) }
