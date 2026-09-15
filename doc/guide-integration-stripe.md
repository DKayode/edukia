# Guide d'Intégration Stripe : Cartes Bancaires, Diaspora & Apple Pay

Ce guide détaille le fonctionnement, la configuration et l'utilisation de **Stripe** dans Edukia pour le backend, le web et l'application mobile Flutter.

---

## 1. Pourquoi Stripe dans Edukia ?

Alors que **KKiaPay** et **FedaPay** sont optimisés pour le Mobile Money en Afrique de l'Ouest, **Stripe** est la solution pour :
* **La diaspora :** Parents ou proches en Europe, aux USA ou au Canada payant pour un élève en Afrique.
* **Les cartes bancaires internationales :** Visa, Mastercard, American Express.
* **Apple Pay & Google Pay :** Disponibles nativement sur la page de paiement Stripe Checkout sans surcoût ni validation complexe.

---

## 2. Configuration du Dashboard Stripe

### A. Récupérer les clés API
1. Connectez-vous sur [dashboard.stripe.com](https://dashboard.stripe.com).
2. Dans le menu de gauche, allez dans **Développeurs > Clés API**.
3. Récupérez :
   * **Clé publiable :** `pk_test_...` (ou `pk_live_...`)
   * **Clé secrète :** `sk_test_...` (ou `sk_live_...`)

### B. Configurer les Webhooks
1. Dans le Dashboard Stripe, allez dans **Développeurs > Webhooks**.
2. Cliquez sur **Ajouter un point de terminaison**.
3. **URL du point de terminaison :**  
   `https://api.educ-prime.com/paiements/webhooks/stripe`
4. **Événements à écouter :**
   * `checkout.session.completed` *(Paiement réussi)*
   * `checkout.session.expired` *(Session expirée)*
   * `payment_intent.payment_failed` *(Échec de paiement)*
5. Cliquez sur **Ajouter un point de terminaison**.
6. Cliquez sur **Révéler** sous "Secret pour la signature" et notez la clé commençant par **`whsec_...`**.

---

## 3. Configuration dans Edukia Backend (.env)

Dans le fichier `.env` de l'API backend :

```env
# Configuration Stripe
STRIPE_PUBLIC_KEY=pk_test_51TeKF...
STRIPE_SECRET_KEY=sk_test_51TeKF...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_DEVISE_DEFAUT=EUR
```

---

## 4. Flux API : Comment fonctionne l'initiation

### A. Requête d'initiation (Client $\rightarrow$ Backend) :

```http
POST /paiements/initier
Authorization: Bearer <TOKEN_JWT>
Content-Type: application/json

{
  "abonnement_uuid": "8960c6bb-4cc3-49da-876e-1b22842e7701",
  "prestataire": "STRIPE"
}
```

### B. Réponse du Backend :

Le backend crée automatiquement une session Stripe Checkout et renvoie l'`url_paiement` :

```json
{
  "uuid": "5c9e2b10-63bf-4f67-8d02-3c81e3bc2144",
  "prestataire": "STRIPE",
  "statut": "EN_ATTENTE",
  "montant": 5,
  "devise": "EUR",
  "url_paiement": "https://checkout.stripe.com/c/pay/cs_test_a1PVUmuA5QzM1B21N43qU45mzMjNP9k3mWEuEAlecuZQ2a8TVbt47Grpgs",
  "token_client": "cs_test_a1PVUmuA5QzM1B21N43qU45mzMjNP9k3mWEuEAlecuZQ2a8TVbt47Grpgs"
}
```

---

## 5. Intégration Côté Frontend Web

Pour le site Web (React, Vue, HTML, etc.), l'intégration est immédiate :

```javascript
// Après avoir appelé POST /paiements/initier :
const reponse = await api.initierPaiement({
  abonnement_uuid: abonnementUuid,
  prestataire: 'STRIPE',
});

// Redirection directe vers la page sécurisée Stripe Checkout :
window.location.href = reponse.url_paiement;
```

Lorsque l'utilisateur valide son paiement sur Stripe, il est automatiquement redirigé vers l'URL configurée par Edukia :
`https://educ-prime.com/abonnements?paiement={UUID}&id={CHECKOUT_SESSION_ID}&status=approved`

---

## 6. Intégration Côté Application Mobile (Flutter)

Bonne nouvelle : **Le flux Flutter est 100 % identique à celui de FedaPay !**  
Le composant `WebView` intercepte la redirection Stripe dès que le paiement est terminé.

```dart
// Réutiliser le composant FedaPayCheckoutPage ou un composant générique HostedCheckoutPage
Navigator.push(
  context,
  MaterialPageRoute(
    builder: (_) => FedaPayCheckoutPage(
      paiementUuid: paiement['uuid'],
      urlPaiement: paiement['url_paiement'],
      onPaiementTermine: () {
        // L'abonnement a été activé en direct !
        rafraichirAbonnement();
      },
    ),
  ),
);
```

### Confirmation Backend automatique :
Quand la WebView intercepte l'URL contenant `?id={SESSION_ID}&status=approved`, elle appelle l'endpoint unifié :

```http
POST /paiements/{uuid}/transaction-prestataire
Authorization: Bearer <TOKEN_JWT>
Content-Type: application/json

{
  "reference_prestataire": "cs_test_a1PVUmuA5QzM1..."
}
```

Le backend interroge Stripe en direct et active l'abonnement immédiatement.

---

## 7. Cartes de Test Officielles Stripe

Pour tester en mode Sandbox sans débiter de vraie carte :

| Scénario | Numéro de carte | Date d'expiration | CVC | Code postal |
| :--- | :--- | :--- | :--- | :--- |
| **Paiement Réussi** | `4242 4242 4242 4242` | N'importe quelle date future | `123` | N'importe lequel |
| **Carte Refusée** | `4000 0000 0000 0035` | N'importe quelle date future | `123` | N'importe lequel |
| **Fonds insuffisants** | `4000 0000 0000 9995` | N'importe quelle date future | `123` | N'importe lequel |

---

## 8. Synthèse des 3 Prestataires Edukia

| Prestataire | Utilisation principale | Expérience utilisateur |
| :--- | :--- | :--- |
| **KKiaPay** | Mobile Money (Bénin, Côte d'Ivoire, Togo, Sénégal) | Widget SDK natif Flutter / Popup Web |
| **FedaPay** | Mobile Money & Cartes locales UEMOA | Page Checkout hébergée (WebView) |
| **Stripe** | Diaspora (Europe, USA), Cartes internationales, Apple Pay | Page Stripe Checkout (WebView / Redirection Web) |
