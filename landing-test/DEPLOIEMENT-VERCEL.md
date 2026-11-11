# Déploiement Vercel + Airwallex (WanWan Play)

Objectif : mettre en ligne le site de `landing-test/` sur Vercel avec le paiement Airwallex (Visa, Mastercard, Apple Pay, Google Pay).
Branche à déployer : `feature/airwallex-checkout` (ne PAS la fusionner dans `main` : Hostinger sert `main` et le site actuel changerait avant que le paiement soit prêt).
Le code est déjà écrit et testé en local contre un faux serveur Airwallex. Voir `README.md` (section « Paiement Airwallex ») et `.env.example`.

## Règles de sécurité
- Ne jamais écrire de clé API, secret de webhook ou mot de passe dans le dépôt, les commits ou les logs. Les clés sont saisies uniquement dans Vercel (Environment Variables).
- Les clés Airwallex sont créées par Charly (propriétaire du compte Airwallex) et transmises par un canal privé.

## Étapes

1. **Vercel** : se connecter à vercel.com avec le compte GitHub propriétaire de `wtccjc13-eng/wanwanplay` (« Continue with GitHub »). Le plan Hobby est réservé à l'usage personnel non commercial : sélectionner un plan compatible avec cette boutique, sans souscrire automatiquement. Source : https://vercel.com/docs/plans/hobby.
2. **Importer le projet** : Add New > Project > `wanwanplay`.
   - Root Directory : `landing-test`
   - Framework Preset : Express (détecté automatiquement)
   - Si l'interface permet de choisir la branche dès l'import, sélectionner `feature/airwallex-checkout`. Sinon configurer cette branche avant de lancer le déploiement de paiement. Ne jamais fusionner cette branche dans `main` pour contourner l'import.
3. **Branche de production** : Project > Settings > Git > Production Branch = `feature/airwallex-checkout`, puis redéployer.
4. **Base de données** : Project > Storage / Marketplace > Upstash Redis. Vérifier l'offre gratuite et les éventuels frais dans l'interface avant de créer la base, puis la relier aux environnements de test souhaités. Vercel crée `KV_REST_API_URL` et `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL`/`_TOKEN`) : le code accepte les deux noms. Sur Vercel, le checkout répond 503 tant que Redis n'est pas configuré. Utiliser une base séparée avant de passer aux paiements réels : les environnements Preview/Development ne doivent pas modifier les commandes et compteurs de production.
5. **Variables d'environnement** (Settings > Environment Variables, au minimum pour Production) :
   - `BASE_URL` = URL publique du site (ex. `https://xxx.vercel.app`, puis `https://wanwanplay.com` au passage en production)
   - `AIRWALLEX_ENV` = `demo` (puis `prod` à la mise en production)
   - `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY` (clés de l'environnement correspondant, fournies par Charly)
   - `AIRWALLEX_WEBHOOK_SECRET` (voir étape 6)
   - `AIRWALLEX_COUNTRY_CODE` = `TW` (à confirmer avec Airwallex : TW ou HK)
   - optionnel : `PRICE_EUR`, `SHIPPING_EUR`, `PRODUCT_NAME`
   Redéployer après chaque modification de variables.
6. **Webhook Airwallex** (fait par Charly dans l'app Airwallex : Developer > Webhooks) : URL `<BASE_URL>/airwallex/webhook`, événement `payment_intent.succeeded`. `BASE_URL` contient déjà `https://`. Copier la clé de signature dans `AIRWALLEX_WEBHOOK_SECRET`. L'URL doit être accessible à Airwallex : une page d'authentification Vercel à sa place empêcherait la livraison. Ne pas désactiver globalement la protection du projet pour contourner cela ; définir l'accès au webhook avec le propriétaire.
7. **Tests en démo** : acheter avec une carte de test Airwallex ; tester un code promo (`TEST10`), un paiement refusé, Apple Pay et Google Pay sur téléphone. Vérifier dans les logs Vercel (`[commande payée] ...`) que la commande passe à « payée » une seule fois, et que le code promo n'est compté qu'une fois.
8. **Production** : clés `prod`, `AIRWALLEX_ENV=prod`, nouveau webhook en production, un vrai achat de quelques euros puis remboursement.
9. **Domaine** (plus tard, après validation) : ajouter `wanwanplay.com` dans Project > Settings > Domains et modifier les DNS chez le registrar. Garder l'ancien réglage Hostinger de côté pour pouvoir revenir en arrière.

## Vérifications effectuées dans le code
- Le format HMAC-SHA256 de `x-timestamp` suivi du corps brut, en hexadécimal, correspond à la documentation : https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events. Cela ne remplace pas un événement effectivement envoyé par Airwallex.
- Le réglage `AIRWALLEX_ENV=demo` appelle `https://api.sandbox.airwallex.com`, et le navigateur reçoit `sandbox`, valeur attendue par Airwallex.js : https://www.airwallex.com/docs/js/.
- Le pays du client (`country_code` de la page hébergée) est distinct du pays marchand des portefeuilles.
- Redis enregistre le statut payé et le compteur promotionnel dans une seule opération Lua atomique, sans verrou permanent. `npm test` couvre une erreur de stockage suivie de relivraisons concurrentes, la signature incorrecte, le corps altéré et le montant incorrect, avec services factices uniquement.

## Points non vérifiés (à surveiller)
- Vrai webhook Airwallex, vraie base Upstash et parcours de paiement sandbox à tester après configuration des comptes. Les tests factices ne prouvent ni la livraison réseau ni l'exécution Lua sur Upstash.
- Le code pays Apple Pay / Google Pay (`AIRWALLEX_COUNTRY_CODE`).
- Mentions légales, CGV, politique de retour (14 jours pour les clients européens) et confidentialité : à vérifier avant la production.
