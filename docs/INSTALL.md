# Installing OneLoom on a Windows PC

> Version française : [INSTALL.fr.md](INSTALL.fr.md)

OneLoom is a **portable** app: it needs no administrator rights and no installer, and does not
change system settings. It works for any Windows user. Nothing in it refers to a specific user,
PC or company.

**Requirements:** Windows 10 (2004 or later) or Windows 11, 64‑bit. OneDrive is optional but
recommended, because recordings are saved there.

---

## Option A — Ready‑to‑run zip (recommended)

Use this if the repository has a **Release** with a file named `OneLoom-<version>-win-x64.zip`.

1. Open <https://github.com/imadui/ScreenOP/releases> and download `OneLoom-<version>-win-x64.zip`.
   The repository is private: ask the owner to invite you, then sign in to GitHub first.
2. Right‑click the zip → **Extract All…** and pick a folder **outside OneDrive**, for example
   `%LOCALAPPDATA%\Programs\OneLoom` (paste this into the Explorer address bar).
3. Open the extracted folder and double‑click **`OneLoom.exe`**.
4. If Windows shows *"Windows protected your PC"* (SmartScreen), click **More info → Run anyway**.
   This happens because the app is not code‑signed.
5. Optional: right‑click `OneLoom.exe` → **Pin to Start** / **Pin to taskbar**.

> On a company‑managed PC, application control (AppLocker, WDAC, privilege management…) may block
> unsigned executables. If OneLoom won't start, ask your IT team to allow it or to sign it. Do not
> try to bypass the policy.

## Option B — Build it yourself from the source zip

Use this if there is no Release, or if you want to modify the app.

1. **Install Node.js 22.12 or newer (LTS).**
   - Normal PC: install from <https://nodejs.org>.
   - Managed PC without admin rights: request Node.js from your company software portal. Or download
     the **Windows Binary (.zip)** from nodejs.org, extract it to `%LOCALAPPDATA%\nodejs`, and in
     each new PowerShell window run:
     ```powershell
     $env:Path = "$env:LOCALAPPDATA\nodejs;$env:Path"
     ```
2. On the repository page, click **Code → Download ZIP**. Extract it to a folder **outside
   OneDrive**, for example `%USERPROFILE%\projects\ScreenOP`. Keeping it out of OneDrive avoids
   syncing about 500 MB of `node_modules`.
3. Open **PowerShell** in that folder (in Explorer: *File → Open Windows PowerShell*, or type
   `powershell` in the address bar) and run:
   ```powershell
   npm install
   npm run dist
   ```
   The first run downloads Electron (about 110 MB) into the project's own `.cache` folder.
4. Start **`release\win-unpacked\OneLoom.exe`**. You can copy the whole `release\win-unpacked`
   folder anywhere, or share `release\OneLoom-<version>-win-x64.zip` with colleagues; that is
   Option A.

Developers can run `npm run dev` instead (hot reload).

> `npm run dist:installer` builds a classic `.exe` installer, but electron‑builder then downloads
> and runs its own 7‑Zip, which security tools on managed PCs may block. The portable zip from
> `npm run dist` needs nothing extra; it uses the `tar.exe` built into Windows.

---

## First launch checklist

1. **Recordings folder:** the home screen shows where videos go, normally
   `…\OneDrive…\loom\recording`.
   - It is created automatically.
   - If OneDrive isn't set up, click **Choose a folder…** (or open **Settings → Recordings folder**).
2. **Camera and microphone:** if they don't appear, open **Windows Settings → Privacy & security →
   Camera / Microphone**. Turn on *Let desktop apps access your camera / microphone*.
3. **Tray:** closing the window keeps OneLoom running in the system tray. Right‑click the tray icon
   → **Quit OneLoom** to exit.
4. **Optional:** **Settings → Start OneLoom when I sign in**, so the recorder is ready instantly.

## Recording

1. Click **New recording**, or press **Ctrl + Shift + R** anywhere.
2. Pick what to record:
   - **Screens**: a whole monitor.
   - **Windows / Browsers**: one app window. To record a single browser tab, keep it in front or
     drag it into its own window.
   - **Remote & VMs**: Remote Desktop (`mstsc`), "Desktop Viewer" virtual desktops, Windows App,
     Hyper‑V, VMware, Citrix…
     - Minimised sessions are listed too; clicking one restores it.
     - Keep the session window open while recording.
3. Choose the microphone, and **System audio** (this also captures sound from the VM).
4. **Camera:** turn it on and a round bubble appears on your screen.
   - Drag it anywhere. Hover it to grow or shrink it, change its shape, or hide it.
   - The panel has **Left / Right**, **S / M / L** and **Background**.
5. Click **Start recording** → 3‑2‑1.
   - The small pill at the bottom lets you pause, mute the mic, hide the camera or resize it,
     discard, or stop.
   - **Ctrl + Shift + P** pauses/resumes and **Ctrl + Shift + S** stops.
6. When you stop, the video opens in the player and is already saved in your recordings folder.

## Camera background (blur or image)

**Settings → Camera**:
- choose the camera;
- toggle *Mirror my camera*;
- pick **None**, **Blur**, **Strong blur**, one of the built‑in backgrounds, or **Upload…** your
  own JPG/PNG/WebP image.

The preview updates live. The effect runs on your PC only.

## Trim a recording

In the library, click **…** on a recording → **Trim** (or **Trim** in the player).
1. Drag the yellow handles to set the start and the end. **Play selection** previews it.
2. Click **Save trim**. The trimmed video replaces the file in your recordings folder, and the
   original goes to the **Recycle Bin**.

## Updating

Download the new zip and replace the app folder. Your settings and library are kept in
`%APPDATA%\OneLoom`; your videos stay in the recordings folder.

## Uninstalling

1. Right‑click the tray icon → **Quit OneLoom**.
2. Delete the app folder.
3. Optional: delete `%APPDATA%\OneLoom` (settings, thumbnails, backgrounds, logs).

Your recordings in `OneDrive\loom\recording` are never deleted.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| First start takes 15–30 s | Normal on PCs with heavy endpoint security. Enable *Start OneLoom when I sign in* so it waits in the tray. |
| "OneDrive was not detected" | Sign in to OneDrive, or pick a folder in **Settings → Recordings folder**. |
| Camera or mic missing / "access denied" | Windows **Settings → Privacy & security → Camera / Microphone** → allow desktop apps. Close other apps using the camera (Teams, Zoom). |
| A window records black or frozen | It is minimised or uses protected content. Restore it, or record the whole screen. |
| My VM / RDP window isn't listed | Open the session, then press the refresh button in the picker. Minimised sessions are listed with "Minimized — click to restore". |
| "System audio unavailable" | No playback device, or loopback capture is blocked. Recording continues without system audio. |
| Background effects unavailable | The PC lacks WebGL/WebAssembly support (rare). The camera works without effects. |
| A shortcut does nothing | Another app owns it. Settings shows which shortcuts are unavailable; you can turn global shortcuts off. |
| Logs | `%APPDATA%\OneLoom\logs\oneloom.log` (the path is also shown in Settings). |
