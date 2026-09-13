# Documentation d'Intégration KPI — Client Mobile

Ce document spécifie le contrat d'API, les modèles de données et les règles métier du point de terminaison KPI (`GET /kpi`) pour l'équipe de développement mobile.

---

## 1. Vue d'Ensemble de l'Endpoint

- **Méthode** : `GET`
- **Route** : `/kpi`
- **Authentification** : `Bearer <JWT_TOKEN>` (Header `Authorization`)
- **Paramètres de requête (Query Params)** :
  - `startDate` *(obligatoire)* : Date de début au format `YYYY-MM-DD` (ex: `2026-08-01`)
  - `endDate` *(obligatoire)* : Date de fin au format `YYYY-MM-DD` (ex: `2026-08-31`)
  - `country` *(optionnel / géré par contexte)* : Code pays en minuscules (ex: `benin`, `togo`, `senegal`). Par défaut, le pays de l'utilisateur authentifié.

### Comportement temporel & Fuseaux horaires
- Les bornes de date sont converties dans le **fuseau horaire local du pays** (ex: `Africa/Porto-Novo` pour le Bénin, UTC+1).
- `endDate` est **inclusif** de toute la journée (la borne SQL s'arrête à `endDate + 1 jour 00:00:00`).

---

## 2. Structure Complète de la Réponse JSON

```json
{
  "pays": "benin",
  "periode": {
    "startDate": "2026-08-01",
    "endDate": "2026-08-31"
  },
  "utilisateurs": {
    "total": 1250,
    "professeurs": 180,
    "autres": 120,
    "age_35_max": 950,
    "age_ranges": {
      "moins_18": 150,
      "de_18_25": 520,
      "de_26_35": 280,
      "plus_35": 300
    },
    "femmes": 540,
    "femmes_35_max": 420,
    "zone_rurale": 210,
    "situation_handicap": 35,
    "connectes": 890
  },
  "apprenants": {
    "total": 950,
    "age_35_max": 890,
    "age_ranges": {
      "moins_18": 150,
      "de_18_25": 500,
      "de_26_35": 240,
      "plus_35": 60
    },
    "age_35_max_femmes": 400,
    "femmes": 430,
    "zone_rurale": 180,
    "situation_handicap": 28
  },
  "engagement": {
    "apprenants_actifs": 680,
    "apprenants_connectes": 610,
    "apprenants_ressource": {
      "semaine": 340,
      "deux_semaines": 490,
      "mois": 630
    }
  },
  "audience": {
    "modules": [
      {
        "type": "opportunite",
        "libelle": "Opportunités",
        "vues": 1450,
        "utilisateurs": 420,
        "top": [
          { "id": 42, "titre": "Bourse d'Excellence Master", "vues": 310, "utilisateurs": 180 }
        ]
      },
      { "type": "offre", "libelle": "Offres (emplois)", "vues": 890, "utilisateurs": 310, "top": [] },
      { "type": "service", "libelle": "Services", "vues": 450, "utilisateurs": 190, "top": [] },
      { "type": "evenement", "libelle": "Événements", "vues": 620, "utilisateurs": 280, "top": [] },
      { "type": "parcours", "libelle": "Parcours inspirants", "vues": 390, "utilisateurs": 150, "top": [] },
      { "type": "forum", "libelle": "Forums", "vues": 1200, "utilisateurs": 510, "top": [] },
      { "type": "publicite", "libelle": "Publicités", "vues": 780, "utilisateurs": 340, "top": [] }
    ],
    "opportunites": {
      "bourses": { "vues": 980, "utilisateurs": 320 },
      "stages": { "vues": 470, "utilisateurs": 180 }
    },
    "total_vues": 5780,
    "utilisateurs_distincts": 840
  },
  "contenu": [
    { "type": "opportunite", "libelle": "Opportunités", "publies": 12, "total": 85 },
    { "type": "offre", "libelle": "Offres (emplois)", "publies": 8, "total": 45 },
    { "type": "service", "libelle": "Services", "publies": 15, "total": 120 },
    { "type": "evenement", "libelle": "Événements", "publies": 4, "total": 29 },
    { "type": "parcours", "libelle": "Parcours inspirants", "publies": 2, "total": 18 },
    { "type": "forum", "libelle": "Forums", "publies": 25, "total": 140 },
    { "type": "publicite", "libelle": "Publicités", "publies": 3, "total": 15 }
  ],
  "communaute": {
    "forums_ouverts": 25,
    "commentaires": 340,
    "commentateurs": 120,
    "likes": 890,
    "likeurs": 230
  },
  "jobkia": {
    "prestataires_inscrits": 45,
    "prestataires_total": 210,
    "recruteurs_inscrits": 12,
    "recruteurs_total": 60,
    "services_publies": 30,
    "offres_publiees": 8,
    "avis_deposes": 14
  },
  "croissance": {
    "activation": {
      "cohorte": 1250,
      "actives": 890,
      "taux": 71.2
    },
    "retention": {
      "j7": 34.5,
      "j30": 22.8
    },
    "assiduite": {
      "wau": 450,
      "mau": 890,
      "collage": 50.6
    },
    "profil": {
      "completion_moyenne": 65,
      "comptes": 1250
    },
    "monetisation": {
      "abonnements_actifs": 0,
      "abonnements_souscrits": 12,
      "portefeuilles": 340,
      "transactions": 128
    }
  },
  "journaux": {
    "ressources_depuis": "2026-07-01",
    "connexions_depuis": "2026-08-11",
    "audience_modules_depuis": "2026-08-11"
  }
}
```

---

## 3. Définitions et Rôles des Indicateurs

### A. Utilisateurs (`utilisateurs`)
> **Important** : Ces chiffres correspondent aux utilisateurs **inscrits durant la période** `[startDate, endDate]`.

| Clé | Type | Description |
|---|---|---|
| `total` | `int` | Nombre total d'inscrits sur la période. |
| `professeurs` | `int` | Inscrits avec le rôle `professeur`. |
| `autres` | `int` | Inscrits avec le rôle `autre` (non étudiant, non prof, non admin). |
| `age_35_max` | `int` | Utilisateurs âgés de 35 ans ou moins (cumul `< 18` + `18 - 25` + `26 - 35`). |
| `age_ranges.moins_18` | `int` | Tranche d'âge `< 18 ans`. |
| `age_ranges.de_18_25` | `int` | Tranche d'âge `18 - 25 ans`. |
| `age_ranges.de_26_35` | `int` | Tranche d'âge `26 - 35 ans`. |
| `age_ranges.plus_35` | `int` | Tranche d'âge `> 35 ans` (regroupe `36 - 50` et `> 50`). |
| `femmes` | `int` | Utilisatrices (`sexe = 'F'`). |
| `femmes_35_max` | `int` | Utilisatrices âgées de 35 ans ou moins. |
| `zone_rurale` | `int` | Utilisateurs résidant en zone rurale (`zone_residence = 'rural'`). |
| `situation_handicap`| `int` | Utilisateurs ayant déclaré un handicap (`situation_handicap = true`). |
| `connectes` | `int` | Utilisateurs distincts ayant effectué au moins 1 connexion sur la période. |

### B. Apprenants (`apprenants`)
Même découpage que ci-dessus, mais filtré strictement sur le rôle `étudiant`.
- `total` : Apprenants inscrits sur la période.
- `age_ranges` : Tranches `< 18`, `18 - 25`, `26 - 35`, `> 35`.
- `zone_rurale`, `situation_handicap`, `femmes`.

### C. Engagement (`engagement`)
| Clé | Type | Règle Métier |
|---|---|---|
| `apprenants_actifs` | `int` | **Indicateur d'activité réel** : Apprenants distincts ayant soit ouvert une session (`login_events`), soit consulté une ressource (`resource_access`) dans les **30 jours glissants** précédant `endDate`. |
| `apprenants_connectes` | `int` | Apprenants distincts connectés au cours de la période sélectionnée. |
| `apprenants_ressource.semaine` | `int` | Apprenants distincts ayant consulté une ressource académique (épreuve/concours) dans les **7 derniers jours** avant `endDate`. |
| `apprenants_ressource.deux_semaines` | `int` | Idem sur **14 jours**. |
| `apprenants_ressource.mois` | `int` | Idem sur **30 jours**. |

### D. Audience des fonctionnalités (`audience`)
| Clé | Description |
|---|---|
| `modules` | Liste des modules (opportunités, offres, services, événements, parcours, forums, pubs) avec `vues`, `utilisateurs` uniques, et `top` 5 des fiches. |
| `opportunites.bourses` | `vues` et `utilisateurs` spécifiques aux opportunités de type **Bourses**. |
| `opportunites.stages` | `vues` et `utilisateurs` spécifiques aux opportunités de type **Stages**. |
| `total_vues` | Somme globale des consultations de fiches. |
| `utilisateurs_distincts`| Nombre d'utilisateurs distincts ayant consulté au moins une fiche (sans double compte si un utilisateur visite plusieurs modules). |

---

## 4. Modèles de Données pour le Développeur Mobile

### TypeScript / React Native
```typescript
export interface AgeRanges {
  moins_18: number;
  de_18_25: number;
  de_26_35: number;
  plus_35: number;
}

export interface KpiResponse {
  pays: string;
  periode: { startDate: string; endDate: string };
  utilisateurs: {
    total: number;
    professeurs: number;
    autres: number;
    age_35_max: number;
    age_ranges: AgeRanges;
    femmes: number;
    femmes_35_max: number;
    zone_rurale: number;
    situation_handicap: number;
    connectes: number;
  };
  apprenants: {
    total: number;
    age_35_max: number;
    age_ranges: AgeRanges;
    age_35_max_femmes: number;
    femmes: number;
    zone_rurale: number;
    situation_handicap: number;
  };
  engagement: {
    apprenants_actifs: number;
    apprenants_connectes: number;
    apprenants_ressource: {
      semaine: number;
      deux_semaines: number;
      mois: number;
    };
  };
  audience: {
    modules: Array<{
      type: string;
      libelle: string;
      vues: number;
      utilisateurs: number;
      top: Array<{ id: number; titre: string; vues: number; utilisateurs: number }>;
    }>;
    opportunites?: {
      bourses: { vues: number; utilisateurs: number };
      stages: { vues: number; utilisateurs: number };
    };
    total_vues: number;
    utilisateurs_distincts: number;
  };
}
```

### Dart / Flutter
```dart
class AgeRanges {
  final int moins18;
  final int de1825;
  final int de2635;
  final int plus35;

  AgeRanges({
    required this.moins18,
    required this.de1825,
    required this.de2635,
    required this.plus35,
  });

  factory AgeRanges.fromJson(Map<String, dynamic> json) {
    return AgeRanges(
      moins18: json['moins_18'] ?? 0,
      de1825: json['de_18_25'] ?? 0,
      de2635: json['de_26_35'] ?? 0,
      plus35: json['plus_35'] ?? 0,
    );
  }
}
```

### Kotlin / Android
```kotlin
data class AgeRanges(
    @SerializedName("moins_18") val moins18: Int = 0,
    @SerializedName("de_18_25") val de1825: Int = 0,
    @SerializedName("de_26_35") val de2635: Int = 0,
    @SerializedName("plus_35") val plus35: Int = 0
)

data class OpportunitySubtypeAudience(
    val vues: Int = 0,
    val utilisateurs: Int = 0
)

data class OpportunitiesAudience(
    val bourses: OpportunitySubtypeAudience = OpportunitySubtypeAudience(),
    val stages: OpportunitySubtypeAudience = OpportunitySubtypeAudience()
)
```

---

## 5. Recommandations UI pour l'Application Mobile

1. **Tuiles de Synthèse en En-tête (Top Bar / Summary Cards)** :
   - Total Inscrits : `utilisateurs.total`
   - Apprenants Inscrits : `apprenants.total`
   - Utilisateurs Connectés : `utilisateurs.connectes`
   - **Apprenants Actifs (30 j)** : Utilisez impérativement `engagement.apprenants_actifs` (ne pas confondre avec `apprenants_ressource.mois` qui n'inclut que les épreuves académiques).

2. **Graphique de Répartition par Tranche d'Âge** :
   - Affichez un diagramme à barres ou circulaire avec les 4 tranches : `< 18 ans`, `18 - 25 ans`, `26 - 35 ans`, `> 35 ans` extraites de `utilisateurs.age_ranges`.

3. **Cartes Opportunités (Bourses & Stages)** :
   - Sous la section Audience, afficher une carte séparée pour les Bourses (`audience.opportunites.bourses`) et les Stages (`audience.opportunites.stages`) avec consultations et visiteurs uniques.

4. **Gestion de l'Historique / Données Vides** :
   - Si la date de début sélectionnée est antérieure à `journaux.connexions_depuis` (ex: avant le 11 août 2026), afficher un message d'information : *"Le suivi des connexions a débuté le 11 août 2026. Les périodes antérieures n'ont pas d'historique."*
