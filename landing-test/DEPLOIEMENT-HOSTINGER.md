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
   - `DATA_DIR` : chemin absolu d'un dossier persistant HORS du dépôt, du répertoire de déploiement et de `public/`, ex. `/home/<utilisateur>/wanwanplay-data`. Remplacer `<utilisateur>` par le compte réel ; cet exemple n'est pas un chemin Hostinger vérifié. Confirmer que l'offre et le processus Node.js permettent l'accès à ce dossier et qu'il survit aux redéploiements. Le serveur le crée si nécessaire et refuse de démarrer s'il est inutilisable. Il contiendra `orders.json` et `promo-uses.json`.
   - `AIRWALLEX_ENV` = `demo` (puis `prod`), `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`, `AIRWALLEX_WEBHOOK_SECRET`
   - `AIRWALLEX_COUNTRY_CODE` = `TW` (à confirmer avec Airwallex : TW ou HK)
   - optionnel : `PRICE_EUR`, `SHIPPING_EUR`, `PRODUCT_NAME`
   Redéployer ou redémarrer après chaque changement.
5. **Webhook Airwallex** (créé par Charly dans l'application Airwallex, Developer > Webhooks) : URL `<BASE_URL>/airwallex/webhook`, événement `payment_intent.succeeded`. `BASE_URL` contient déjà `https://`. Copier la clé secrète dans `AIRWALLEX_WEBHOOK_SECRET`.
6. **Tests en démo** : achat avec une carte de test Airwallex ; code promo (`TEST10`) ; paiement refusé ; Apple Pay et Google Pay sur téléphone. Vérifier dans les logs hPanel `[commande payée] ...` : la commande passe à « payée » une seule fois et le code promo n'est compté qu'une fois. Vérifier que les fichiers de `DATA_DIR` survivent à un redéploiement.
7. **Production** : clés `prod` et `AIRWALLEX_ENV=prod`, nouveau webhook en production, un vrai achat de quelques euros puis remboursement.
   En mode `prod`, le checkout reste fermé (503) tant que Client ID, API key et secret du webhook ne sont pas tous renseignés. Les routes de paiement simulé sont désactivées. Le fichier Apple déjà fourni est servi à son URL `.well-known` par une route explicite, avec le type `application/octet-stream`.
8. **Domaine** : une fois tout validé, rattacher `wanwanplay.com` à l'application Node.js (Hostinger demande de retirer l'ancien site du domaine avant de créer l'application). Sauvegarder les fichiers du site actuel avant (`dist/`, `landing-test/public/`) pour pouvoir revenir en arrière.

## Stockage fichiers et option Redis

- Sans Redis, `DATA_DIR` vide conserve le dossier local `landing-test/data/`. Un chemin relatif est résolu depuis le dossier de `server.js`, indépendamment du dossier courant du processus. Sur Hostinger, renseigner un chemin absolu persistant hors du site.
- Pour migrer des données existantes, arrêter l'application, sauvegarder puis copier `orders.json` et `promo-uses.json` ensemble depuis l'ancien dossier vers le nouveau avant de changer `DATA_DIR` et redémarrer. Un dossier vide ne reprend pas automatiquement les anciennes commandes. Ne pas écraser une base existante.
- Sauvegarder régulièrement ces fichiers hors du serveur. Vérifier leur présence et une commande déjà payée après un vrai redéploiement Hostinger.
- Ce stockage JSON convient à une seule instance Node.js avec disque persistant. Plusieurs instances nécessitent une base partagée : configurer `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`, ou les alias `KV_REST_API_URL` / `KV_REST_API_TOKEN`. Redis prend alors la priorité, sans écrire les fichiers de `DATA_DIR` ; aucune migration automatique vers Redis n'est effectuée.

## Vérifications effectuées dans le code
- Le format HMAC-SHA256 de `x-timestamp` suivi du corps brut, en hexadécimal, correspond à la documentation Airwallex (https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events). Cela ne remplace pas un événement réellement envoyé par Airwallex.
- `AIRWALLEX_ENV=demo` appelle l'API sandbox (`https://api.sandbox.airwallex.com`) et le navigateur reçoit l'environnement `sandbox` (à confirmer au premier test réel).
- Avec Redis, le statut payé et le compteur de code promo sont enregistrés dans une seule opération Lua, sans verrou permanent. Le stockage fichiers ne fournit pas la même transaction en cas d'arrêt brutal pendant une écriture.
- `npm test` utilise un faux serveur Airwallex : paiement avec `TEST10`, signature invalide et montant incorrect, panne Redis puis relivraisons, et conservation d'une commande payée et de son compteur dans un `DATA_DIR` externe après redémarrage. Aucun paiement réel n'est effectué.

## Points non vérifiés (à surveiller)
- Vrai webhook Airwallex et parcours de paiement sandbox : à tester après configuration des comptes. Si le test réel renvoie 401, comparer `awSignatureOk` dans `server.js` avec la documentation.
- Code pays Apple Pay / Google Pay (`AIRWALLEX_COUNTRY_CODE`).
- Mentions légales, CGV, politique de retour (14 jours pour les clients européens) et confidentialité : à vérifier avant l'ouverture au public.
