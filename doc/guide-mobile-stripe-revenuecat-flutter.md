# Guide Flutter — Stripe et RevenueCat

Ce document décrit les deux flux de paiement mobile d’Edukia :

- Stripe pour les cartes bancaires et les paiements web/diaspora ;
- RevenueCat pour les abonnements natifs Apple App Store et Google Play.

Les clés secrètes ne doivent jamais être incluses dans Flutter. Seules les clés
publiques RevenueCat peuvent être embarquées dans l’application.

## 1. Choisir le bon flux

| Besoin | Prestataire | Flux Flutter |
|---|---|---|
| Carte bancaire, diaspora, Apple Pay/Google Pay via checkout | Stripe | `POST /paiements/initier` puis WebView/URL Stripe |
| Abonnement numérique vendu dans l’application iOS/Android | RevenueCat | SDK `purchases_flutter`, sans `/paiements/initier` |

RevenueCat centralise les achats App Store et Google Play. Le mobile lance
l’achat via RevenueCat, puis lit l’Entitlement actif. Le backend reçoit les
webhooks RevenueCat pour la synchronisation serveur.

## 2. Préparer les produits

Choisir des identifiants stables avant de publier. Exemple :

```text
edukia_premium_monthly
edukia_premium_yearly
```

Le même abonnement métier doit être rattaché au même Entitlement RevenueCat,
même si son identifiant produit Apple et son identifiant produit Google sont
différents.

### Apple App Store Connect

1. Accepter les accords **Paid Apps** et compléter les informations fiscales et
   bancaires.
2. Dans **Apps → Edukia → Monetization → Subscriptions**, créer un groupe
   d’abonnements.
3. Créer les abonnements auto-renouvelables mensuel et annuel avec des Product
   IDs définitifs.
4. Renseigner le prix, la durée, le nom et la localisation.
5. Créer un utilisateur Sandbox dans **Users and Access → Sandbox**.
6. Ajouter une build iOS à App Store Connect et tester avec TestFlight ou un
   appareil Sandbox.
7. Dans RevenueCat, connecter l’application iOS avec les informations App Store
   Connect demandées par le dashboard, puis importer les produits.

Les changements de métadonnées peuvent prendre du temps à apparaître dans le
Sandbox. Ne pas utiliser une clé secrète App Store Connect dans Flutter.

### Google Play Console

1. Créer l’application avec le même package ID que Flutter, par exemple
   `com.edukia.app`.
2. Créer une release sur une piste **Internal testing** ou **Closed testing**.
   Google Play demande généralement qu’un APK/AAB soit disponible avant les
   tests de produits.
3. Dans **Monetize → Products → Subscriptions**, créer le produit
   `edukia_premium`.
4. Ajouter les base plans mensuel et annuel, leurs prix et les pays concernés,
   puis les activer.
5. Ajouter les comptes de test dans **License testing**.
6. Dans RevenueCat, connecter Google Play avec un compte de service disposant
   des permissions nécessaires, puis importer le produit et ses base plans.

Pour Google Play, le Product ID et le base plan doivent correspondre à la
configuration RevenueCat. Un produit créé mais non activé n’apparaîtra pas dans
les offerings.

## 3. Configurer RevenueCat

Dans le projet RevenueCat :

1. Créer ou sélectionner le projet Edukia.
2. Ajouter les apps iOS et Android avec leurs identifiants exacts.
3. Importer les produits Apple et Google.
4. Créer l’Entitlement `premium`.
5. Attacher les produits mensuel et annuel à `premium`.
6. Créer l’Offering `default` et ses packages : `$rc_monthly` et `$rc_annual`
   ou des packages personnalisés.
7. Récupérer les deux clés publiques SDK, une pour iOS et une pour Android.
8. Créer un webhook RevenueCat vers :

```text
https://api.educ-prime.com/paiements/webhooks/revenuecat
```

Configurer soit un header Authorization partagé, soit la signature HMAC
RevenueCat. Dans Edukia, ces valeurs se renseignent dans la configuration
`REVENUECAT` :

```text
secret_key              clé secrète RevenueCat pour l’API serveur
webhook_authorization   valeur Authorization envoyée par RevenueCat
webhook_secret          secret HMAC si la signature est activée
entitlement_id          premium
```

Le webhook doit écouter au minimum `INITIAL_PURCHASE`, `RENEWAL`,
`EXPIRATION`, `CANCELLATION`, `BILLING_ISSUE`, `PRODUCT_CHANGE` et
`NON_RENEWING_PURCHASE`.

## 4. Intégration Flutter RevenueCat

Installer le SDK :

```bash
flutter pub add purchases_flutter
```

Configuration initiale :

```dart
import 'dart:io';
import 'package:purchases_flutter/purchases_flutter.dart';

class RevenueCatService {
  static const _iosKey = String.fromEnvironment('RC_IOS_PUBLIC_KEY');
  static const _androidKey = String.fromEnvironment('RC_ANDROID_PUBLIC_KEY');

  static Future<void> configure(String edukiaUserUuid) async {
    final apiKey = Platform.isIOS ? _iosKey : _androidKey;
    if (apiKey.isEmpty) {
      throw StateError('Clé publique RevenueCat absente pour cette plateforme');
    }

    final configuration = PurchasesConfiguration(apiKey);
    configuration.appUserID = edukiaUserUuid;
    await Purchases.configure(configuration);
  }

  static Future<Offering?> currentOffering() async {
    final offerings = await Purchases.getOfferings();
    return offerings.current;
  }

  static Future<CustomerInfo> purchase(Package package) async {
    final result = await Purchases.purchasePackage(package);
    return result.customerInfo;
  }

  static Future<bool> hasPremium() async {
    final info = await Purchases.getCustomerInfo();
    return info.entitlements.active.containsKey('premium');
  }

  static Future<CustomerInfo> restore() {
    return Purchases.restorePurchases();
  }
}
```

Dans Edukia, utiliser l’UUID utilisateur comme `appUserID` après connexion.
Ne pas utiliser un identifiant aléatoire différent à chaque lancement. Si le
SDK a d’abord créé un utilisateur anonyme, appeler `Purchases.logIn(uuid)` après
la connexion pour rattacher l’historique au compte Edukia.

Affichage des offres :

```dart
final offering = await RevenueCatService.currentOffering();
final monthly = offering?.monthly;
final annual = offering?.annual;
```

Achat :

```dart
if (monthly != null) {
  final customerInfo = await RevenueCatService.purchase(monthly);
  final active = customerInfo.entitlements.active.containsKey('premium');
  if (active) {
    // Rafraîchir le profil et les droits Edukia.
  }
}
```

Restaurer les achats est obligatoire dans l’interface compte :

```dart
await RevenueCatService.restore();
```

Le mobile doit prévoir les états `PurchaseCancelledError`, absence d’offre,
produit indisponible, achat en attente et erreur réseau.

## 5. Synchronisation avec Edukia

Le SDK RevenueCat est la source immédiate des droits côté mobile. Le webhook
est la source serveur pour les renouvellements et expirations.

À chaque ouverture de session :

1. configurer RevenueCat avec l’UUID Edukia ;
2. lire `CustomerInfo.entitlements.active['premium']` ;
3. rafraîchir le profil Edukia ;
4. ne jamais considérer uniquement le résultat local d’un écran de paiement
   comme une preuve serveur.

Avant la mise en production, le backend doit relier `event.app_user_id` au
compte Edukia et `entitlement_id` au plan Edukia correspondant. Cette liaison
doit être testée avec un webhook `TEST`, un achat initial, un renouvellement et
une expiration.

## 6. Intégration Flutter Stripe

Le flux Stripe Edukia reste différent de RevenueCat :

```text
Flutter → POST /paiements/initier (prestataire STRIPE)
        ← url_paiement + uuid du paiement
Flutter → ouvre url_paiement dans une WebView
Stripe  → redirige vers /abonnements?paiement=...
Backend → webhook Stripe vérifie et active l’abonnement
```

Requête :

```http
POST https://api.educ-prime.com/paiements/initier
Authorization: Bearer <JWT_EDUKIA>
Content-Type: application/json

{
  "abonnement_uuid": "UUID_ABONNEMENT",
  "prestataire": "STRIPE"
}
```

Ouvrir `url_paiement` avec `webview_flutter`. La WebView ne doit pas traiter
elle-même le paiement ni recevoir la clé secrète Stripe. Après le retour, le
mobile peut interroger :

```http
GET /paiements/{paiement_uuid}
Authorization: Bearer <JWT_EDUKIA>
```

Le webhook Stripe configuré côté serveur est :

```text
https://api.educ-prime.com/paiements/webhooks/stripe
```

Événements minimum : `checkout.session.completed`, `checkout.session.expired`
et `payment_intent.payment_failed`.

Les clés Stripe restent dans le back-office/backend : `pk_...` peut être
publique, mais `sk_...` et `whsec_...` ne doivent jamais entrer dans le code
Flutter.

## 7. Checklist de recette

- [ ] Package Android et Bundle ID iOS identiques à ceux déclarés dans les stores.
- [ ] Produits Apple créés et disponibles dans Sandbox.
- [ ] Produit Google et base plans activés sur une piste de test.
- [ ] Produits importés dans RevenueCat.
- [ ] `premium` créé et relié aux produits.
- [ ] Offering `default` avec packages mensuel et annuel.
- [ ] Clés publiques RevenueCat injectées par plateforme dans Flutter.
- [ ] `appUserID` stable et égal à l’UUID Edukia.
- [ ] Webhook RevenueCat configuré et signé.
- [ ] Stripe testé séparément avec les cartes de test.
- [ ] Achat, restauration, renouvellement, expiration et annulation vérifiés.

## Références officielles

- [RevenueCat — Flutter](https://www.revenuecat.com/docs/getting-started/installation/flutter)
- [RevenueCat — configuration SDK](https://www.revenuecat.com/docs/getting-started/configuring-sdk)
- [RevenueCat — produits, Entitlements et Offerings](https://www.revenuecat.com/docs/projects/configuring-products)
- [RevenueCat — webhooks](https://www.revenuecat.com/docs/integrations/webhooks)
- [Apple — In-App Purchases](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases)
- [Google — abonnements Play Billing](https://developer.android.com/google/play/billing/subscriptions)
- [Stripe — guide Edukia existant](./guide-integration-stripe.md)
