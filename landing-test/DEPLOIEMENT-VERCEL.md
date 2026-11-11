# Déploiement Vercel + Airwallex (WanWan Play)

Objectif : mettre en ligne le site de `landing-test/` sur Vercel avec le paiement Airwallex (Visa, Mastercard, Apple Pay, Google Pay).
Branche à déployer : `feature/airwallex-checkout` (ne PAS la fusionner dans `main` : Hostinger sert `main` et le site actuel changerait avant que le paiement soit prêt).
Le code est déjà écrit et testé en local contre un faux serveur Airwallex. Voir `README.md` (section « Paiement Airwallex ») et `.env.example`.

## Règles de sécurité
- Ne jamais écrire de clé API, secret de webhook ou mot de passe dans le dépôt, les commits ou les logs. Les clés sont saisies uniquement dans Vercel (Environment Variables).
- Les clés Airwallex sont créées par Charly (propriétaire du compte Airwallex) et transmises par un canal privé.

## Étapes

1. **Vercel** : se connecter à vercel.com avec le compte GitHub propriétaire de `wtccjc13-eng/wanwanplay` (« Continue with GitHub »). Plan Hobby gratuit.
2. **Importer le projet** : Add New > Project > `wanwanplay`.
   - Root Directory : `landing-test`
   - Framework Preset : Express (détecté automatiquement)
   - Lancer le déploiement. Le premier déploiement sur `main` peut échouer (ancien code), c'est normal.
3. **Branche de production** : Project > Settings > Git > Production Branch = `feature/airwallex-checkout`, puis redéployer.
4. **Base de données** : Project > Storage > Create > Upstash Redis (gratuit), la relier au projet pour Production, Preview et Development. Vercel crée `KV_REST_API_URL` et `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL`/`_TOKEN`) : le code accepte les deux noms.
5. **Variables d'environnement** (Settings > Environment Variables, au minimum pour Production) :
   - `BASE_URL` = URL publique du site (ex. `https://xxx.vercel.app`, puis `https://wanwanplay.com` au passage en production)
   - `AIRWALLEX_ENV` = `demo` (puis `prod` à la mise en production)
   - `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY` (clés de l'environnement correspondant, fournies par Charly)
   - `AIRWALLEX_WEBHOOK_SECRET` (voir étape 6)
   - `AIRWALLEX_COUNTRY_CODE` = `TW` (à confirmer avec Airwallex : TW ou HK)
   - optionnel : `PRICE_EUR`, `SHIPPING_EUR`, `PRODUCT_NAME`
   Redéployer après chaque modification de variables.
6. **Webhook Airwallex** (fait par Charly dans l'app Airwallex : Developer > Webhooks) : URL `https://<BASE_URL>/airwallex/webhook`, événement `payment_intent.succeeded`. Copier la clé de signature dans `AIRWALLEX_WEBHOOK_SECRET`.
7. **Tests en démo** : acheter avec une carte de test Airwallex ; tester un code promo (`TEST10`), un paiement refusé, Apple Pay et Google Pay sur téléphone. Vérifier dans les logs Vercel (`[commande payée] ...`) que la commande passe à « payée » une seule fois, et que le code promo n'est compté qu'une fois.
8. **Production** : clés `prod`, `AIRWALLEX_ENV=prod`, nouveau webhook en production, un vrai achat de quelques euros puis remboursement.
9. **Domaine** (plus tard, après validation) : ajouter `wanwanplay.com` dans Project > Settings > Domains et modifier les DNS chez le registrar. Garder l'ancien réglage Hostinger de côté pour pouvoir revenir en arrière.

## Points non vérifiés (à surveiller)
- Le format de signature du webhook (HMAC-SHA256 de `x-timestamp` + corps brut, en hexadécimal) est écrit d'après la connaissance de l'API, pas testé avec Airwallex. Si les webhooks reçoivent un 401, vérifier la signature dans `landing-test/server.js` (fonction `awSignatureOk`) contre la documentation Airwallex.
- Le code pays Apple Pay / Google Pay (`AIRWALLEX_COUNTRY_CODE`).
- Mentions légales, CGV, politique de retour (14 jours pour les clients européens) et confidentialité : à vérifier avant la production.
