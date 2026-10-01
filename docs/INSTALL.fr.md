# Mode opératoire : installer OneLoom sur un PC Windows

> English version: [INSTALL.md](INSTALL.md)

OneLoom est une application **portable** : pas de droits administrateur, pas d'installeur, aucun
paramètre système modifié. Elle fonctionne pour n'importe quel utilisateur Windows. Rien dans
l'application n'est lié à un utilisateur, un PC ou une entreprise en particulier.

**Prérequis :** Windows 10 (version 2004 ou plus récente) ou Windows 11, 64 bits. OneDrive est
facultatif mais recommandé, car les enregistrements y sont sauvegardés.

---

## Option A — Zip prêt à l'emploi (recommandé)

À utiliser si le dépôt propose une **Release** contenant un fichier `OneLoom-<version>-win-x64.zip`.

1. Ouvrir <https://github.com/imadui/ScreenOP/releases> et télécharger
   `OneLoom-<version>-win-x64.zip`. Le dépôt est privé : demandez au propriétaire de vous inviter,
   puis connectez‑vous à GitHub.
2. Clic droit sur le zip → **Extraire tout…**. Choisir un dossier **en dehors de OneDrive**, par
   exemple `%LOCALAPPDATA%\Programs\OneLoom` (à coller dans la barre d'adresse de l'Explorateur).
3. Ouvrir le dossier extrait et double‑cliquer sur **`OneLoom.exe`**.
4. Si Windows affiche *« Windows a protégé votre ordinateur »* (SmartScreen), cliquer sur
   **Informations complémentaires → Exécuter quand même**. Ce message s'affiche parce que
   l'application n'est pas signée.
5. Facultatif : clic droit sur `OneLoom.exe` → **Épingler à l'écran de démarrage** / **à la barre
   des tâches**.

> Sur un PC géré par l'entreprise, le contrôle des applications (AppLocker, WDAC, gestion des
> privilèges…) peut bloquer les exécutables non signés. Si OneLoom ne démarre pas, demandez à votre
> équipe IT de l'autoriser ou de le signer. N'essayez pas de contourner la politique de sécurité.

## Option B — Construire l'application à partir du zip des sources

À utiliser s'il n'y a pas de Release, ou si vous voulez modifier l'application.

1. **Installer Node.js 22.12 ou plus récent (LTS).**
   - PC classique : installer depuis <https://nodejs.org>.
   - PC géré sans droits admin : demander Node.js via le portail logiciel de l'entreprise. Ou bien
     télécharger le **Windows Binary (.zip)** sur nodejs.org, l'extraire dans
     `%LOCALAPPDATA%\nodejs`, puis exécuter dans chaque nouvelle fenêtre PowerShell :
     ```powershell
     $env:Path = "$env:LOCALAPPDATA\nodejs;$env:Path"
     ```
2. Sur la page du dépôt : **Code → Download ZIP**. Extraire le zip **en dehors de OneDrive**, par
   exemple `%USERPROFILE%\projects\ScreenOP`. Cela évite de synchroniser environ 500 Mo de
   `node_modules`.
3. Ouvrir **PowerShell** dans ce dossier (dans l'Explorateur, taper `powershell` dans la barre
   d'adresse) puis lancer :
   ```powershell
   npm install
   npm run dist
   ```
   Le premier lancement télécharge Electron (environ 110 Mo) dans le dossier `.cache` du projet.
4. Lancer **`release\win-unpacked\OneLoom.exe`**. Le dossier `release\win-unpacked` peut être
   copié n'importe où, et `release\OneLoom-<version>-win-x64.zip` peut être partagé avec vos
   collègues : c'est l'option A.

Pour les développeurs : `npm run dev` lance l'application en mode développement (rechargement à
chaud).

> `npm run dist:installer` produit un installeur `.exe` classique. electron‑builder télécharge
> alors son propre 7‑Zip, que les outils de sécurité des PC gérés peuvent bloquer. Le zip portable
> de `npm run dist` n'en a pas besoin : il utilise le `tar.exe` intégré à Windows.

---

## Vérifications au premier lancement

1. **Dossier des enregistrements :** l'écran d'accueil indique où vont les vidéos, normalement
   `…\OneDrive…\loom\recording`.
   - Il est créé automatiquement.
   - Si OneDrive n'est pas configuré, cliquer sur **Choisir un dossier…** (ou ouvrir
     **Paramètres → Dossier des enregistrements**).
2. **Caméra et micro :** s'ils n'apparaissent pas, ouvrir **Paramètres Windows → Confidentialité
   et sécurité → Caméra / Microphone**. Activer *Autoriser les applications de bureau à accéder à
   votre caméra / microphone*.
3. **Zone de notification :** fermer la fenêtre laisse OneLoom tourner dans la zone de
   notification. Clic droit sur l'icône → **Quit OneLoom** pour quitter.
4. **Facultatif :** **Paramètres → Démarrer OneLoom à l'ouverture de session**, pour que
   l'enregistreur soit prêt instantanément.

## Enregistrer

1. Cliquer sur **New recording**, ou appuyer sur **Ctrl + Maj + R** n'importe où.
2. Choisir quoi enregistrer :
   - **Screens** : un écran entier.
   - **Windows / Browsers** : la fenêtre d'une application. Pour un seul onglet de navigateur,
     le garder au premier plan ou le détacher dans sa propre fenêtre.
   - **Remote & VMs** : Bureau à distance (`mstsc`), bureaux virtuels « Desktop Viewer »,
     Windows App, Hyper‑V, VMware, Citrix…
     - Les sessions réduites sont aussi listées ; cliquer dessus les restaure.
     - Garder la fenêtre de la session ouverte pendant l'enregistrement.
3. Choisir le micro, et **System audio** (cela capte aussi le son de la VM).
4. **Caméra :** l'activer fait apparaître une bulle ronde à l'écran.
   - La déplacer où vous voulez. Au survol, elle se grossit, se réduit, change de forme ou se
     masque.
   - Le panneau propose aussi **Left / Right**, **S / M / L** et **Background**.
5. Cliquer sur **Start recording** → 3‑2‑1.
   - La petite barre en bas permet de mettre en pause, couper le micro, masquer ou
     redimensionner la caméra, annuler ou arrêter.
   - **Ctrl + Maj + P** met en pause / reprend et **Ctrl + Maj + S** arrête.
6. À l'arrêt, la vidéo s'ouvre dans le lecteur ; elle est déjà enregistrée dans votre dossier.

## Arrière‑plan de la caméra (flou ou image)

**Paramètres → Camera** :
- choisir la caméra ;
- activer ou non *Mirror my camera* ;
- choisir **None**, **Blur**, **Strong blur**, un fond intégré, ou **Upload…** pour utiliser votre
  propre image (JPG, PNG ou WebP).

L'aperçu est en direct. L'effet est calculé uniquement sur votre PC.

## Couper une vidéo (trim)

Dans la bibliothèque, cliquer sur **…** d'un enregistrement → **Trim** (ou **Trim** dans le
lecteur).
1. Faire glisser les poignées jaunes pour définir le début et la fin. **Play selection** permet de
   prévisualiser.
2. Cliquer sur **Save trim**. La vidéo coupée remplace le fichier dans votre dossier, et
   l'original part dans la **Corbeille**.

## Mettre à jour

Télécharger le nouveau zip et remplacer le dossier de l'application. Les paramètres et la
bibliothèque sont conservés dans `%APPDATA%\OneLoom`, et vos vidéos restent dans le dossier des
enregistrements.

## Désinstaller

1. Clic droit sur l'icône de la zone de notification → **Quit OneLoom**.
2. Supprimer le dossier de l'application.
3. Facultatif : supprimer `%APPDATA%\OneLoom` (paramètres, miniatures, fonds, journaux).

Vos enregistrements dans `OneDrive\loom\recording` ne sont jamais supprimés.

## Dépannage

| Symptôme | Solution |
| --- | --- |
| Le premier démarrage prend 15 à 30 s | Normal sur les PC avec une sécurité poste de travail lourde. Activer *Démarrer à l'ouverture de session* pour que l'app attende dans la zone de notification. |
| « OneDrive was not detected » | Se connecter à OneDrive, ou choisir un dossier dans **Paramètres → Dossier des enregistrements**. |
| Caméra ou micro absents / « accès refusé » | **Paramètres Windows → Confidentialité et sécurité → Caméra / Microphone** → autoriser les applications de bureau. Fermer les autres applications qui utilisent la caméra (Teams, Zoom). |
| Une fenêtre s'enregistre en noir ou figée | Elle est réduite ou affiche un contenu protégé. La restaurer, ou enregistrer l'écran entier. |
| Ma VM / fenêtre RDP n'apparaît pas | Ouvrir la session, puis cliquer sur le bouton d'actualisation du sélecteur. Une session réduite apparaît avec « Minimized — click to restore ». |
| « System audio unavailable » | Pas de périphérique de lecture, ou capture en boucle bloquée. L'enregistrement continue sans le son système. |
| Effets d'arrière‑plan indisponibles | Le PC ne prend pas en charge WebGL/WebAssembly (rare). La caméra fonctionne sans effets. |
| Un raccourci ne fait rien | Une autre application l'utilise déjà. Les Paramètres indiquent les raccourcis indisponibles ; les raccourcis globaux peuvent être désactivés. |
| Journaux | `%APPDATA%\OneLoom\logs\oneloom.log` (le chemin est aussi affiché dans les Paramètres). |
