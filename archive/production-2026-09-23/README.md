# Archive de la production du 23 septembre 2026

Copies de sauvegarde trouvées dans le déploiement Netlify `6ab41720`.
Elles sont gardées ici pour référence uniquement : ce dossier n'est ni publié
sur le site, ni déployé comme fonction.

## functions/

Anciennes versions qui étaient déployées comme de vraies fonctions et
revendiquaient la même route que la fonction principale :

| Fichier | Route revendiquée | Différence avec la version principale |
|---|---|---|
| `sumup-checkout-before-server-confirmation.mts` | `/api/sumup-checkout` | n'enregistre pas l'identifiant du checkout, pas d'adresse de notification |
| `sumup-checkout-before-webhook-url-fix.mts` | `/api/sumup-checkout` | envoie la page d'accueil à SumUp comme adresse de notification : le webhook n'est jamais appelé |
| `account-orders-before-order-linking.mts` | `/api/account-orders` | ne rattache pas les commandes invitées au compte |
| `account-orders-ready-order-linking.mts` | `/api/account-orders` | identique à la version principale |
| `auth-google-before-order-linking.mts` | `/.netlify/functions/auth-google-before-order-linking` | identique à `auth-google.mts` |

## html/

Onze copies successives de `index.html` et un bloc CSS isolé.

## db/

`schema.backup.ts` : schéma d'avant l'ajout des comptes clients (table `orders` seule).
