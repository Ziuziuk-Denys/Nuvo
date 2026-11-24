param([long]$Handle)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Icon {
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
}
"@
foreach ($kind in @(@("small", 0), @("big", 1))) {
  $icon = [Win32Icon]::SendMessage([IntPtr]$Handle, 0x7F, [IntPtr]$kind[1], [IntPtr]::Zero)
  if ($icon -eq [IntPtr]::Zero) { continue }
  $bitmap = [System.Drawing.Icon]::FromHandle($icon).ToBitmap()
  $middle = [int]($bitmap.Width / 2)
  Write-Output "$($kind[0]) $($bitmap.Width) $($bitmap.GetPixel($middle, $middle).B)"
}
