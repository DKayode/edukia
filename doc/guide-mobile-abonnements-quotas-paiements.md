# Guide d'Intégration Mobile : Abonnements, Quotas et Paiements (KKiaPay & FedaPay)

> **Destinataires :** Équipe de développement Mobile (Flutter)  
> **Date de mise à jour :** Septembre 2026  
> **Version API :** v1  
> **Statut :** Validé & Prêt pour intégration  

---

## 1. Contexte & Résumé des Changements

Ce guide détaille le fonctionnement unifié de la gestion des **abonnements**, des **quotas gratuits**, de l'accès à **Ketsia IA**, ainsi que les flux de paiement **KKiaPay** et **FedaPay** pour l'application mobile Edukia.

### Problème résolu (Ketsia IA & Quotas)
Auparavant :
- La route `GET /abonnements/mon-abonnement` renvoyait l'entité brute sans indicateur direct d'activation pour Ketsia.
- La route `GET /abonnements/mes-quotas` renvoyait `est_actif: false` pour `KETSIA_AI`, ce qui induisait l'application mobile en erreur en pensant que Ketsia était désactivé, alors que `est_actif` ne désignait que l'activation de la règle de *quota gratuit*.
- Ketsia IA (service backend autonome) vérifie le JWT de l'utilisateur : si le token JWT ne contient pas le claim `abonnement_actif: true`, l'accès est refusé même si l'abonnement est actif en base de données.

### Ce qui a été mis en place côté API
1. **`GET /abonnements/mon-abonnement`** enrichi avec `abonnement_actif: boolean` et `ketsia_actif: boolean`.
2. **`GET /abonnements/mes-quotas`** clarifié avec :
   - `acces_actif: boolean` : **Le champ unique à vérifier pour donner l'accès à l'utilisateur**.
   - `abonnement_actif: boolean` : indique si couvert par l'abonnement.
   - `quota_gratuit_actif: boolean` : renommé pour éviter toute confusion avec l'état du service.
   - `reason: "SUBSCRIBED" | "FREE_QUOTA" | "UNLIMITED" | "NO_QUOTA_CONFIGURED" | "EXHAUSTED"` : explication claire du statut.
3. **Paiements FedaPay intégrés côté backend** : génération automatique de l'URL de checkout FedaPay (`url_paiement`).
4. **Règle absolue pour le mobile** : après tout paiement confirmé, appeler **`POST /auth/refresh`** pour mettre à jour le JWT avec les nouveaux droits.

---

## 2. Distinction Fondamentale : Quota Gratuit vs Abonnement

| Concept | Définition | Comportement Mobile |
| :--- | :--- | :--- |
| **Quota Gratuit** | Nombre d'utilisations gratuites par jour/semaine/mois sans abonnement (ex: 3 épreuves gratuites). | Décrémenté à chaque utilisation (`quota_restant`). Quand il tombe à 0, l'accès est bloqué jusqu'au prochain reset ou jusqu'à un abonnement. |
| **Abonnement** | Formule payante active (ex: Plan Mensuel Bénin). | Donne un accès **illimité** (`illimite: true`) aux fonctionnalités incluses (ex: Ketsia IA). Le quota gratuit ne s'applique plus (`quota_applicable: false`). |

---

## 3. Spécification des Routes API

### 3.1. Obtenir son abonnement : `GET /abonnements/mon-abonnement`

Retourne l'abonnement en cours de l'utilisateur connecté pour son pays.

- **Méthode :** `GET`
- **URL :** `/abonnements/mon-abonnement?country=benin`
- **Headers :** `Authorization: Bearer <ACCESS_TOKEN>`

#### Exemple de Réponse (Utilisateur Abonné)
```json
{
  "id": 2,
  "uuid": "c4b008cd-32e4-4e9a-b634-d33b2fa62276",
  "pays": "benin",
  "statut": "ACTIF",
  "date_debut": "2026-09-13T20:52:33.398Z",
  "date_fin": "2026-10-13T20:52:33.398Z",
  "montant_paye": 2000,
  "devise": "XOF",
  "abonnement_actif": true,
  "ketsia_actif": true,
  "plan": {
    "id": 1,
    "nom": "Pass Mensuel",
    "slug": "pass-mensuel",
    "ketsia_inclus": true,
    "telechargements_illimites": true
  }
}
```

#### Exemple de Réponse (Aucun Abonnement ou Expiré)
```json
{
  "abonnement_actif": false,
  "ketsia_actif": false,
  "statut": "INACTIF",
  "message": "Aucun abonnement actif trouvé"
}
```

---

### 3.2. Consulter ses quotas : `GET /abonnements/mes-quotas`

Renvoie l'état de consommation et d'accès pour chaque fonctionnalité (`KETSIA_AI`, `EPREUVES`, `CORRECTIONS`, `RESUMES`).

- **Méthode :** `GET`
- **URL :** `/abonnements/mes-quotas?country=benin`
- **Headers :** `Authorization: Bearer <ACCESS_TOKEN>`

#### Exemple de Réponse (Utilisateur Abonné)
```json
{
  "abonnement_actif": true,
  "pays": "benin",
  "quotas": {
    "KETSIA_AI": {
      "fonctionnalite": "KETSIA_AI",
      "acces_actif": true,
      "abonnement_actif": true,
      "quota_gratuit_actif": false,
      "illimite": true,
      "quota_applicable": false,
      "quota_restant": null,
      "limite": null,
      "utilise": 0,
      "periode": null,
      "date_reinitialisation": null,
      "reason": "SUBSCRIBED"
    },
    "EPREUVES": {
      "fonctionnalite": "EPREUVES",
      "acces_actif": true,
      "abonnement_actif": true,
      "quota_gratuit_actif": true,
      "illimite": true,
      "quota_applicable": false,
      "quota_restant": null,
      "limite": 5,
      "utilise": 1,
      "periode": "JOUR",
      "reason": "SUBSCRIBED"
    }
  }
}
```

#### Exemple de Réponse (Utilisateur Non Abonné / Quota Gratuit)
```json
{
  "abonnement_actif": false,
  "pays": "benin",
  "quotas": {
    "KETSIA_AI": {
      "fonctionnalite": "KETSIA_AI",
      "acces_actif": false,
      "abonnement_actif": false,
      "quota_gratuit_actif": false,
      "illimite": false,
      "quota_applicable": false,
      "quota_restant": 0,
      "limite": 0,
      "utilise": 0,
      "periode": null,
      "reason": "NO_QUOTA_CONFIGURED"
    },
    "EPREUVES": {
      "fonctionnalite": "EPREUVES",
      "acces_actif": true,
      "abonnement_actif": false,
      "quota_gratuit_actif": true,
      "illimite": false,
      "quota_applicable": true,
      "quota_restant": 3,
      "limite": 5,
      "utilise": 2,
      "periode": "JOUR",
      "date_reinitialisation": "2026-09-15T00:00:00.000Z",
      "reason": "FREE_QUOTA"
    }
  }
}
```

> **Règle UI Mobile pour afficher un cadenas ou autoriser l'action :**
> ```dart
> final canAccess = quota.accesActif; // true = autoriser, false = afficher bannière d'abonnement
> ```

---

## 4. Flux de Paiement (KKiaPay vs FedaPay)

L'API Edukia supporte deux prestataires de paiement : **KKiaPay** et **FedaPay**.

```
                           +------------------------+
                           |     Choix du Moyen     |
                           |       de Paiement      |
                           +-----------+------------+
                                       |
                   +-------------------+-------------------+
                   |                                       |
                   v                                       v
         [ Option 1 : KKiaPay ]                  [ Option 2 : FedaPay ]
                   |                                       |
        SDK Flutter Client-Side                     Backend Checkout URL
        (Mobile Money / Carte)                      (WebView / In-App Browser)
                   |                                       |
 1. POST /abonnements/souscrire              1. POST /abonnements/souscrire
    (prestataire: "KKIAPAY")                    (prestataire: "FEDAPAY")
                   |                                       |
 2. Reçoit { uuid, montant, ... }            2. Reçoit { uuid, url_paiement: "https://checkout.fedapay.com/..." }
                   |                                       |
 3. Ouvre Widget Flutter KKiaPay             3. Ouvre WebView sur url_paiement
    (avec kkiapay_public_key)                              |
                   |                         4. L'utilisateur paie sur FedaPay
 4. Callback KKiaPay: transactionId                        |
                   |                         5. Webhook FedaPay valide en BDD
 5. POST /paiements/:uuid/                              + Redirection vers redirect_url
    transaction-prestataire                                |
                   |                                       |
                   +-------------------+-------------------+
                                       |
                                       v
                     +-----------------------------------+
                     |   6. POST /auth/refresh           |
                     |      (OBLIGATOIRE !)              |
                     |      Nouveau JWT avec             |
                     |      `abonnement_actif: true`     |
                     +-----------------+-----------------+
                                       |
                                       v
                     +-----------------------------------+
                     | 7. Accès Débloqué & Ketsia Prêt   |
                     +-----------------------------------+
```

---

### 4.1. Flux KKiaPay (Widget Flutter)

1. **Initiation :**
   Appeler `POST /abonnements/souscrire` avec le `plan_id` et `prestataire: "KKIAPAY"`.
   ```json
   {
     "plan_id": 1,
     "prestataire": "KKIAPAY",
     "country": "benin"
   }
   ```
   Réponse : contient le paiement créé avec son `uuid`.

2. **Affichage du widget SDK Flutter KKiaPay :**
   Le package `kkiapay_flutter` nécessite la `public_key` de KKiaPay (configurée dans votre app mobile ou obtenue via `GET /paiements/configuration/prestataires`).
   ```dart
   final kkiapay = KKiaPay(
     amount: paiement.montant,
     countries: ["BJ"],
     phone: user.telephone,
     name: "${user.prenom} ${user.nom}",
     email: user.email,
     reason: "Abonnement Edukia - ${plan.nom}",
     data: paiement.uuid,
     sandbox: isSandbox,
     apikey: kkiapayPublicKey,
     callback: (Map<String, dynamic> response, BuildContext context) async {
       // Succès du paiement
       final String transactionId = response['transactionId'];
       await finaliserPaiementKKiaPay(paiement.uuid, transactionId);
     },
   );
   ```

3. **Validation côté Backend :**
   Envoyer l'identifiant de transaction au backend :
   - **Route :** `POST /paiements/{uuid}/transaction-prestataire`
   - **Body :**
     ```json
     {
       "transaction_id": "kkiapay_trans_id_recu_du_widget"
     }
     ```
   Le backend contacte KKiaPay avec sa clé secrète, vérifie la transaction et active l'abonnement.

4. **Rafraîchissement JWT (INDISPENSABLE) :**
   ```dart
   await authService.refreshToken();
   ```

---

### 4.2. Flux FedaPay (Checkout URL / WebView)

FedaPay fonctionne via une redirection Web sécurisée (Checkout Hosted). **Aucune clé publique n'est requise dans l'application mobile** pour ce flux.

1. **Initiation :**
   Appeler `POST /abonnements/souscrire` avec `prestataire: "FEDAPAY"`.
   ```json
   {
     "plan_id": 1,
     "prestataire": "FEDAPAY",
     "country": "benin"
   }
   ```

2. **Réponse Backend avec URL de paiement :**
   Le backend génère la transaction FedaPay, demande le token de checkout et retourne :
   ```json
   {
     "paiement": {
       "uuid": "4391696a-04ae-4da7-9524-2c2da225d2b7",
       "montant": 2000,
       "devise": "XOF",
       "statut": "EN_ATTENTE",
       "url_paiement": "https://checkout.fedapay.com/v1/checkout/tok_sandbox_xxxxxx"
     }
   }
   ```

3. **Affichage dans l'application :**
   Ouvrir `url_paiement` dans un `WebView` in-app ou via `flutter_custom_tabs`.
   - Écouter la redirection vers l'URL de retour (ex: `https://edukia.app/paiement/succes?status=approved` ou deep link `edukia://paiement/succes`).
   - Lorsque la WebView atteint l'URL de succès, fermer la WebView.

4. **Vérification & Rafraîchissement :**
   - FedaPay envoie automatiquement un webhook au backend pour valider le paiement.
   - Dès la fermeture de la WebView, appeler :
     1. `GET /abonnements/mon-abonnement?country=benin` pour vérifier le statut `ACTIF`.
     2. `POST /auth/refresh` pour obtenir le JWT à jour avec `abonnement_actif: true`.

---

## 5. Pourquoi le rafraîchissement du JWT est impératif pour Ketsia IA

Ketsia IA est un microservice d'intelligence artificielle distinct. Pour des raisons de performance, il ne requiert pas la base de données centrale à chaque message de chat. Il lit directement le payload du JWT :

```json
{
  "sub": 22,
  "email": "eleve@edukia.bj",
  "role": "ELEVE",
  "abonnement_actif": true
}
```

Si l'application ne fait pas `POST /auth/refresh` après la souscription, le token conservé en mémoire contiendra toujours `abonnement_actif: false`, et Ketsia répondra avec une erreur 403 Forbidden.

---

## 6. Modèles Dart / Flutter Recommandés

### 6.1. Modèle `MonAbonnement`
```dart
class MonAbonnementResponse {
  final int? id;
  final String? uuid;
  final String? statut;
  final bool abonnementActif;
  final bool ketsiaActif;
  final DateTime? dateFin;
  final String? devise;
  final num? montantPaye;
  final PlanAbonnement? plan;

  MonAbonnementResponse({
    this.id,
    this.uuid,
    this.statut,
    required this.abonnementActif,
    required this.ketsiaActif,
    this.dateFin,
    this.devise,
    this.montantPaye,
    this.plan,
  });

  factory MonAbonnementResponse.fromJson(Map<String, dynamic> json) {
    return MonAbonnementResponse(
      id: json['id'],
      uuid: json['uuid'],
      statut: json['statut'],
      abonnementActif: json['abonnement_actif'] == true,
      ketsiaActif: json['ketsia_actif'] == true,
      dateFin: json['date_fin'] != null ? DateTime.parse(json['date_fin']) : null,
      devise: json['devise'],
      montantPaye: json['montant_paye'],
      plan: json['plan'] != null ? PlanAbonnement.fromJson(json['plan']) : null,
    );
  }
}
```

### 6.2. Modèle `FeatureQuota`
```dart
class FeatureQuotaDetail {
  final String fonctionnalite;
  final bool accesActif;
  final bool abonnementActif;
  final bool quotaGratuitActif;
  final bool illimite;
  final bool quotaApplicable;
  final int? quotaRestant;
  final int? limite;
  final int utilise;
  final String? periode;
  final String? reason;

  FeatureQuotaDetail({
    required this.fonctionnalite,
    required this.accesActif,
    required this.abonnementActif,
    required this.quotaGratuitActif,
    required this.illimite,
    required this.quotaApplicable,
    this.quotaRestant,
    this.limite,
    required this.utilise,
    this.periode,
    this.reason,
  });

  factory FeatureQuotaDetail.fromJson(Map<String, dynamic> json) {
    return FeatureQuotaDetail(
      fonctionnalite: json['fonctionnalite'] ?? '',
      accesActif: json['acces_actif'] == true,
      abonnementActif: json['abonnement_actif'] == true,
      quotaGratuitActif: json['quota_gratuit_actif'] == true || json['est_actif'] == true,
      illimite: json['illimite'] == true,
      quotaApplicable: json['quota_applicable'] == true,
      quotaRestant: json['quota_restant'],
      limite: json['limite'],
      utilise: json['utilise'] ?? 0,
      periode: json['periode'],
      reason: json['reason'],
    );
  }
}
```

---

## 7. Checklist d'Intégration Mobile

- [ ] **Affichage Ketsia IA :** Vérifier `monAbonnement.ketsiaActif` ou `quotas['KETSIA_AI'].accesActif`.
- [ ] **Déblocage Épreuves :** Vérifier `quotas['EPREUVES'].accesActif`.
- [ ] **Compteurs restants :** Si `quotaApplicable == true`, afficher `quotaRestant / limite restants aujourd'hui`. Si `illimite == true`, afficher le badge `Accès Illimité`.
- [ ] **Flux KKiaPay :** Après succès du widget, appeler `POST /paiements/:uuid/transaction-prestataire`.
- [ ] **Flux FedaPay :** Ouvrir `url_paiement` dans la WebView et surveiller la redirection de sortie.
- [ ] **Post-Paiement :** Toujours appeler `POST /auth/refresh` pour enregistrer le nouveau token JWT.
- [ ] **Rechargement d'état :** Ré-interroger `GET /abonnements/mon-abonnement` et `GET /abonnements/mes-quotas` après le refresh.
