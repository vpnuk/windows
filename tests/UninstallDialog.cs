using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

// UI checks only, loaded by the disposable Windows CI test.
public static class VpnukUninstallDialog
{
    public sealed class Control
    {
        public IntPtr Handle;
        public string Text;
        public string ClassName;
        public int Id;
        public bool Enabled;
        public int Top;
    }
    private delegate bool EnumProc(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);

    private static Control Read(IntPtr window)
    {
        var text = new StringBuilder(2048);
        var className = new StringBuilder(256);
        GetWindowText(window, text, text.Capacity);
        GetClassName(window, className, className.Capacity);
        Rect rectangle;
        // Controls can disappear during a page transition; a zero rectangle
        // keeps that stale snapshot out of the radio-group match.
        GetWindowRect(window, out rectangle);
        return new Control { Handle = window, Text = text.ToString(), ClassName = className.ToString(),
            Id = GetDlgCtrlID(window), Enabled = IsWindowEnabled(window), Top = rectangle.Top };
    }
    public static Control[] Dialogs()
    {
        var result = new List<Control>();
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            if (IsWindowVisible(window)) {
                var item = Read(window);
                if (item.ClassName == "#32770" && item.Text.IndexOf("VPNUK", StringComparison.OrdinalIgnoreCase) >= 0)
                    result.Add(item);
            }
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
    public static Control[] Children(IntPtr parent)
    {
        var result = new List<Control>();
        EnumChildWindows(parent, delegate(IntPtr window, IntPtr parameter) {
            if (IsWindowVisible(window)) result.Add(Read(window));
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
    public static int Checked(IntPtr window)
    {
        IntPtr result;
        if (SendMessageTimeout(window, 0x00F0, IntPtr.Zero, IntPtr.Zero, 2, 1000, out result) == IntPtr.Zero)
            throw new InvalidOperationException("Could not read the actual uninstall checkbox.");
        return result.ToInt32();
    }
    public static void Click(IntPtr window)
    {
        // Asynchronous click: page leave legitimately runs long cleanup work.
        if (!PostMessage(window, 0x00F5, IntPtr.Zero, IntPtr.Zero))
            throw new InvalidOperationException("Could not click the uninstall control.");
    }
}
