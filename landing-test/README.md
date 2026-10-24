# 灣灣好日子 野生動物版 — site de vente (WanWan Play)

Site d'une seule page, en **chinois traditionnel (Taïwan)** par défaut et en **anglais**, avec paiement NewebPay (MPG) et codes promo.
Autonome : à placer dans un dossier séparé du repo ou sur une branche `feature/landing-test`. Rien n'écrase l'existant.

## Lancer en local

```bash
npm install
cp .env.example .env     # clés NewebPay vides = mode SIMULATION
npm start                # http://localhost:3000
```

- **Mode simulation** (clés vides) : fausse page de paiement pour valider ou annuler. Aucun appel à NewebPay.
- **Mode NewebPay test** : renseigner `NEWEBPAY_MERCHANT_ID`, `NEWEBPAY_HASH_KEY` (32 car.), `NEWEBPAY_HASH_IV` (16 car.) d'un compte de **test** (https://cwww.newebpay.com). `BASE_URL` doit être une URL publique (ex. tunnel ngrok), sinon NewebPay ne peut pas appeler `/payment/notify`.

## Langues

- Tous les textes sont dans `public/i18n.js` (clés `zh` et `en`). Pour modifier un texte, éditer là.
- Sélecteur par drapeaux 🇹🇼 / 🇺🇸 (SVG, donc visibles aussi sous Windows). Choix mémorisé ; `?lang=en` force l'anglais.
- La langue est transmise à NewebPay (`LangType`) : la page de paiement s'affiche dans la même langue.
- Les `[ ... ]` dans les textes sont à compléter (délai de livraison, nombre de cartes, mentions légales).

## Mobile first

CSS écrit pour le téléphone d'abord (`@media (min-width)` pour enrichir) : champs en 16 px (pas de zoom iOS), cibles tactiles >= 44 px, clavier adapté par champ (`inputmode`, `autocomplete`, `enterkeyhint`), cartes des habitats en carrousel tactile, barre « Commander » fixe en bas (masquée sur le bureau et sur la section commande), marges de sécurité iPhone (`safe-area`). Testé à 360, 390, 768 et 1280 px.

## Prix, conversion et livraison

- Prix **affiché en euros** : `PRICE_EUR` (19.90). Frais de port : `SHIPPING_EUR` (0 = offerts, ligne masquée).
- **NewebPay (MPG) encaisse en TWD** : le serveur convertit le total en euros avec un taux fixe `EUR_TWD_RATE` (1 EUR = X TWD, à mettre à jour) et envoie un montant TWD entier. Le montant TWD est affiché au client avant le paiement ; le taux utilisé est enregistré dans chaque commande. La banque du client applique ensuite son propre taux.
- Vérifier avec NewebPay s'il existe, pour votre compte, une option de paiement en devise étrangère (service multi-devises) ; sinon la conversion se fait comme ci-dessus.
- Livraison **Europe** : UE, Suisse, Royaume-Uni, Norvège. Formulaire : adresse, code postal, ville, pays, téléphone avec indicatif.

## Codes promo

`promo-codes.json` : `percent` (% du sous-total) ou `amount_eur` (montant fixe par commande), avec `maxUses` et `expires`. Le serveur recalcule toujours le prix ; le navigateur ne décide jamais du montant. Un code n'est consommé qu'à la réception d'un paiement validé (le montant TWD notifié doit correspondre). Codes de test : `TEST10`, `WELCOME5`.

## Routes

| Route | Rôle |
|---|---|
| `POST /api/quote` | calcule totaux et promo |
| `POST /api/checkout` | valide le formulaire, crée la commande, prépare le formulaire NewebPay |
| `POST /payment/notify` | confirmation serveur à serveur (seule source de vérité ; le montant payé doit correspondre) |
| `POST /payment/return` | retour du client, affichage uniquement |

Les commandes sont stockées dans `data/orders.json` (suffisant pour un test).

## Visuels

`public/img/` : face de la boîte, ours et 4 cartes, extraits des fichiers fournis (basse résolution). À remplacer par les exports haute définition.

## Avant la production

- Compte marchand NewebPay de production et cartes activées ; `NEWEBPAY_GATEWAY=https://core.newebpay.com/MPG/mpg_gateway`, HTTPS obligatoire.
- Mentions légales pour la vente à des consommateurs européens : identité du vendeur, adresse, contact, droit de rétractation de 14 jours, TVA (prix TTC, guichet OSS selon le cas), CGV, politique de confidentialité (RGPD). Côté Taïwan : 統一編號.
- Pour la phase Taïwan : moyens de paiement locaux (ATM virtuel, supérette) possibles avec NewebPay, mais asynchrones, donc à gérer dans `/payment/notify`.
- Remplacer le stockage fichier par une vraie base, envoyer un e-mail de confirmation.
