# Déploiement Hostinger (Node.js) + Airwallex — WanWan Play

Objectif : faire tourner le site de `landing-test/` sur Hostinger (application Node.js) avec le paiement Airwallex (Visa, Mastercard, Apple Pay, Google Pay).
Branche à déployer : `feature/airwallex-checkout`. Ne PAS la fusionner dans `main` avant validation : le site actuel (pages fixes) est servi depuis `main`.
Prérequis : une offre Hostinger **Business Web Hosting** ou **Cloud** (Node.js non disponible sur les autres offres).
Voir aussi `README.md` (section « Paiement Airwallex ») et `.env.example`.

## Règles de sécurité
- Aucune clé API, secret de webhook ou mot de passe dans le dépôt, les commits ou les logs : uniquement dans les variables d'environnement d'hPanel.
- Les clés Airwallex sont créées par Charly et transmises par un canal privé.
- Ne pas supprimer le site actuel de `wanwanplay.com` avant d'avoir validé l'application sur un domaine temporaire.

## Étapes

1. **hPanel** : Websites > Add Website > **Node.js Apps**. Choisir un **domaine temporaire** proposé par Hostinger (pas encore wanwanplay.com).
2. **Source** : Import Git Repository (autoriser GitHub avec le compte propriétaire de `wtccjc13-eng/wanwanplay`) puis choisir le dépôt `wanwanplay` et la branche `feature/airwallex-checkout`. Alternative : Upload ZIP du dossier du site (sans `node_modules` ni `.git`).
3. **Réglages de build** : Root directory `landing-test` ; framework Express (auto-détecté) ; commande de démarrage `npm start`. Version de Node : 20.x ou 22.x.
4. **Variables d'environnement** :
   - `BASE_URL` : URL publique de l'application (domaine temporaire, puis `https://wanwanplay.com`)
   - `DATA_DIR` : dossier de stockage HORS du dossier du site, ex. `/home/<utilisateur>/wanwanplay-data` (à créer s'il n'existe pas). Il contiendra `orders.json` et `promo-uses.json` : ne pas le perdre au redéploiement.
   - `AIRWALLEX_ENV` = `demo` (puis `prod`), `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`, `AIRWALLEX_WEBHOOK_SECRET`
   - `AIRWALLEX_COUNTRY_CODE` = `TW` (à confirmer avec Airwallex : TW ou HK)
   - optionnel : `PRICE_EUR`, `SHIPPING_EUR`, `PRODUCT_NAME`
   Redéployer ou redémarrer après chaque changement.
5. **Webhook Airwallex** (créé par Charly dans l'application Airwallex, Developer > Webhooks) : URL `https://<BASE_URL>/airwallex/webhook` en HTTPS, événement `payment_intent.succeeded`. Copier la clé secrète dans `AIRWALLEX_WEBHOOK_SECRET`.
6. **Tests en démo** : achat avec une carte de test Airwallex ; code promo (`TEST10`) ; paiement refusé ; Apple Pay et Google Pay sur téléphone. Vérifier dans les logs hPanel `[commande payée] ...` : la commande passe à « payée » une seule fois et le code promo n'est compté qu'une fois. Vérifier que les fichiers de `DATA_DIR` survivent à un redéploiement.
7. **Production** : clés `prod` et `AIRWALLEX_ENV=prod`, nouveau webhook en production, un vrai achat de quelques euros puis remboursement.
8. **Domaine** : une fois tout validé, rattacher `wanwanplay.com` à l'application Node.js (Hostinger demande de retirer l'ancien site du domaine avant de créer l'application). Sauvegarder les fichiers du site actuel avant (`dist/`, `landing-test/public/`) pour pouvoir revenir en arrière.

## Vérifications effectuées dans le code
- Le format HMAC-SHA256 de `x-timestamp` suivi du corps brut, en hexadécimal, correspond à la documentation Airwallex (https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events). Cela ne remplace pas un événement réellement envoyé par Airwallex.
- `AIRWALLEX_ENV=demo` appelle l'API sandbox (`https://api.sandbox.airwallex.com`) et le navigateur reçoit l'environnement `sandbox` (à confirmer au premier test réel).
- Le statut payé et le compteur de code promo sont enregistrés ensemble, sans verrou permanent : un webhook renvoyé après une panne est bien pris en compte. `npm test` couvre ces cas avec des services factices.

## Points non vérifiés (à surveiller)
- Vrai webhook Airwallex et parcours de paiement sandbox : à tester après configuration des comptes. Si le test réel renvoie 401, comparer `awSignatureOk` dans `server.js` avec la documentation.
- Code pays Apple Pay / Google Pay (`AIRWALLEX_COUNTRY_CODE`).
- Mentions légales, CGV, politique de retour (14 jours pour les clients européens) et confidentialité : à vérifier avant l'ouverture au public.
