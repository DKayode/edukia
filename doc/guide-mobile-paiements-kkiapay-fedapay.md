# Guide Intégration Mobile : KKiaPay vs FedaPay (Flutter)

Ce guide est destiné au développeur mobile Flutter. Il détaille pas à pas l'intégration des deux prestataires de paiement supportés par Edukia : **KKiaPay** et **FedaPay**, en mettant en évidence leurs différences et la manière d'obtenir un comportement fluide et immédiat pour les deux.

---

## 1. Vue d'ensemble & Comparatif

Grâce aux endpoints unifiés du backend Edukia, **le cycle de vie et la confirmation sont identiques** pour les deux prestataires :

```text
1. Mobile  ── POST /paiements/initier ──────────────────> Backend
2. Mobile <── { prestataire, payload_initiation / url } ── Backend
3. Mobile  ── Affiche Widget (KKiaPay) OU WebView (FedaPay)
4. Mobile  ── Récupère l'ID de transaction (via Callback OU Interception URL)
5. Mobile  ── POST /paiements/{uuid}/transaction-prestataire ──> Backend (Confirmation immédiate)
6. Mobile  ── Rafraîchit l'abonnement une fois REUSSI
```

### Tableau comparatif

| Critère | KKiaPay | FedaPay | Stripe (CB & Diaspora) |
| :--- | :--- | :--- | :--- |
| **Moyens supportés** | Mobile Money (MTN, Moov) | Mobile Money & Cartes | Cartes CB, Visa, Mastercard, Apple Pay |
| **Méthode d'affichage** | SDK Flutter natif (`kkiapay_flutter_sdk`) | WebView (`webview_flutter`) | **WebView (identique à FedaPay)** |
| **Clé transmise au mobile** | Clé publique dans `payload_initiation.widget.key` | Aucune clé requise | Aucune clé requise |
| **Détection du succès** | Callback du SDK : `response['transactionId']` | Interception redirection `return_url` | **Interception redirection `return_url`** |
| **Paramètre ID extrait** | `transactionId` | Paramètre d'URL `id` | **Paramètre d'URL `id` (Session ID)** |
| **Endpoint de confirmation** | `POST /paiements/{uuid}/transaction-prestataire` | `POST /paiements/{uuid}/transaction-prestataire` | **Le même endpoint unifié** |
| **Délai d'activation** | Immédiat | Immédiat | **Immédiat** |
| **Filet de sécurité** | Webhook PSP + Cron backend 30 min | Webhook PSP + Cron backend 30 min | Webhook PSP + Cron backend 30 min |

---

## 2. Étape 1 : Initialisation commune

Avant d'afficher quoi que ce soit, le mobile demande au backend d'initier le paiement pour l'abonnement en attente :

```http
POST /paiements/initier
Authorization: Bearer <TOKEN_JWT>
Content-Type: application/json

{
  "abonnement_uuid": "8960c6bb-4cc3-49da-876e-1b22842e7701",
  "prestataire": "KKIAPAY", // ou "FEDAPAY"
  "telephone": "22997000000" // Optionnel mais recommandé
}
```

### Réponse pour KKiaPay :
```json
{
  "uuid": "4d42f2ec-4f19-4ac2-9c8c-9d49d1c9c215",
  "prestataire": "KKIAPAY",
  "statut": "EN_ATTENTE",
  "montant": 2000,
  "devise": "XOF",
  "url_paiement": null,
  "payload_initiation": {
    "integration": "widget",
    "widget": {
      "sandbox": true,
      "amount": 2000,
      "currency": "XOF",
      "key": "pk_sandbox_...",
      "callback": "https://educ-prime.com/abonnements?paiement=4d42f2ec...",
      "data": "EDK-1710000000-12-5",
      "reference": "EDK-1710000000-12-5"
    }
  }
}
```

### Réponse pour FedaPay :
```json
{
  "uuid": "9b4b0678-3d12-4c84-97e6-4ccf41531d25",
  "prestataire": "FEDAPAY",
  "statut": "EN_ATTENTE",
  "montant": 2000,
  "devise": "XOF",
  "url_paiement": "https://sandbox-process.fedapay.com/eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "token_client": null
}
```

---

## 3. Flux KKiaPay (SDK Flutter Natif)

Pour KKiaPay, on utilise le package officiel `kkiapay_flutter_sdk`.

### Code Flutter :

```dart
import 'package:flutter/material.dart';
import 'package:kkiapay_flutter_sdk/kkiapay_flutter_sdk.dart';

Future<void> lancerPaiementKkiaPay({
  required BuildContext context,
  required Map<String, dynamic> paiement,
  required String telephone,
  required String nomComplet,
  required String email,
}) async {
  final widgetData = paiement['payload_initiation']['widget'] as Map<String, dynamic>;
  final String paiementUuid = paiement['uuid'];

  final kkiapay = KKiaPay(
    amount: widgetData['amount'] as int,
    apikey: widgetData['key'] as String,
    sandbox: widgetData['sandbox'] as bool,
    phone: telephone,
    name: nomComplet,
    email: email,
    reason: 'Abonnement Edukia',
    data: widgetData['data'] as String,
    callbackUrl: widgetData['callback'] as String,
    countries: const ['BJ', 'CI', 'TG', 'SN'],
    paymentMethods: const ['momo', 'card'],
    callback: (Map<String, dynamic> response, BuildContext ctx) async {
      Navigator.pop(ctx); // Ferme la vue KKiaPay

      // 1. Extraire l'ID de transaction renvoyé par le SDK KKiaPay
      final transactionId = response['transactionId'] as String?;

      if (transactionId != null && transactionId.isNotEmpty) {
        // 2. Notifier immédiatement le backend pour validation et activation
        await confirmerTransactionBackend(paiementUuid, transactionId);
      }

      // 3. Polling de contrôle (le statut est normalement déjà REUSSI)
      await attendreStatutFinal(paiementUuid);
    },
  );

  Navigator.push(context, MaterialPageRoute(builder: (_) => kkiapay));
}
```

---

## 4. Flux FedaPay (WebView avec interception du `return_url`)

FedaPay ne dispose pas de SDK Flutter natif équivalent, mais fonctionne via une URL de checkout hébergée. 

### L'astuce pour avoir le même comportement instantané que KKiaPay :
Lorsque le paiement est validé sur la page FedaPay, le navigateur est redirigé vers l'URL de retour configurée par le backend :
```
https://educ-prime.com/abonnements?paiement={uuid}&id={FEDAPAY_TRANSACTION_ID}&status=approved
```
**La WebView Flutter intercepte cette redirection** avant qu'elle ne se charge, extrait le `id` de la transaction FedaPay, ferme la WebView et appelle le backend exactement comme pour KKiaPay !

### Code Flutter (avec `webview_flutter`) :

```dart
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

class FedaPayCheckoutPage extends StatefulWidget {
  final String paiementUuid;
  final String urlPaiement;
  final VoidCallback onPaiementTermine;

  const FedaPayCheckoutPage({
    Key? key,
    required this.paiementUuid,
    required this.urlPaiement,
    required this.onPaiementTermine,
  }) : super(key: key);

  @override
  State<FedaPayCheckoutPage> createState() => _FedaPayCheckoutPageState();
}

class _FedaPayCheckoutPageState extends State<FedaPayCheckoutPage> {
  late final WebViewController _controller;
  bool _enTraitement = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (NavigationRequest request) {
            final uri = Uri.parse(request.url);

            // Détecter le retour sur la page Edukia (return_url)
            if (request.url.contains('/abonnements?paiement=') ||
                uri.queryParameters.containsKey('id')) {
              _gererRetourPaiement(uri);
              return NavigationDecision.prevent; // Empêche de charger la page web
            }

            return NavigationDecision.navigate;
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.urlPaiement));
  }

  Future<void> _gererRetourPaiement(Uri uri) async {
    if (_enTraitement) return;
    setState(() => _enTraitement = true);

    // 1. Extraire l'ID de transaction FedaPay renvoyé en paramètre d'URL
    final transactionId = uri.queryParameters['id'];
    final status = uri.queryParameters['status'];

    if (transactionId != null && status != 'canceled' && status != 'declined') {
      // 2. Confirmer immédiatement côté backend (exactement comme pour KKiaPay !)
      await confirmerTransactionBackend(widget.paiementUuid, transactionId);
    }

    if (mounted) {
      Navigator.pop(context); // Ferme la WebView
      widget.onPaiementTermine();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Paiement sécurisé FedaPay'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_enTraitement)
            const Center(child: CircularProgressIndicator()),
        ],
      ),
    );
  }
}
```

---

## 5. L'Appel Commun de Confirmation Backend

Que ce soit le `transactionId` issu du SDK KKiaPay ou le `id` intercepté dans l'URL FedaPay, **l'appel API backend est strictement le même** :

```http
POST /paiements/{uuid}/transaction-prestataire
Authorization: Bearer <TOKEN_JWT>
Content-Type: application/json

{
  "reference_prestataire": "TRANSACTION_ID_ICI"
}
```

### Fonction Dart commune :

```dart
Future<void> confirmerTransactionBackend(String paiementUuid, String transactionId) async {
  try {
    final response = await http.post(
      Uri.parse('$baseUrlApi/paiements/$paiementUuid/transaction-prestataire'),
      headers: {
        'Authorization': 'Bearer $tokenJwt',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'reference_prestataire': transactionId,
      }),
    );

    if (response.statusCode == 200 || response.statusCode == 201) {
      debugPrint('Transaction confirmée et abonnement activé avec succès !');
    }
  } catch (e) {
    debugPrint('Erreur confirmation (le webhook ou cron prendra le relais) : $e');
  }
}
```

---

## 6. Polling de Sécurité (Fallback)

Pour garantir une expérience 100% fiable même si l'utilisateur coupe sa connexion juste après avoir payé :

```dart
Future<String> attendreStatutFinal(String paiementUuid) async {
  const int maxTentatives = 10;
  const Duration delai = Duration(seconds: 2);

  for (int i = 0; i < maxTentatives; i++) {
    await Future.delayed(delai);

    final res = await http.get(
      Uri.parse('$baseUrlApi/paiements/$paiementUuid'),
      headers: {'Authorization': 'Bearer $tokenJwt'},
    );

    if (res.statusCode == 200) {
      final body = jsonDecode(res.body);
      final statut = body['statut'] as String;

      if (['REUSSI', 'ECHOUE', 'ANNULE', 'EXPIRE'].contains(statut)) {
        return statut;
      }
    }
  }

  return 'EN_ATTENTE';
}
```

---

## 7. Résumé pour l'équipe Mobile

1. **Aiguillage simple :**
   - Si `paiement.urlPaiement != null` $\rightarrow$ Ouvrir `FedaPayCheckoutPage` (WebView).
   - Si `paiement.prestataire == 'KKIAPAY'` $\rightarrow$ Ouvrir le widget natif `kkiapay_flutter_sdk`.
2. **Fin de paiement :**
   - Récupérer l'ID (callback SDK pour KKiaPay, query param `?id=` pour FedaPay).
   - Appeler `POST /paiements/{uuid}/transaction-prestataire`.
3. **Résultat :**
   - L'abonnement passe immédiatement à `ACTIF` en base de données.
   - Recharger le profil utilisateur / l'état de l'abonnement.
