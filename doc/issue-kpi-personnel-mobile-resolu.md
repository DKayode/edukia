# Issue resolue - KPI personnel mobile

## Statut

Resolu et merge sur `main`.

Commit final : `3e794ac Align personal KPIs with active user`

## Probleme

Les KPI affiches a l'utilisateur dans l'application mobile ne devaient pas etre
les KPI admin ni des KPI globaux par pays.

Le besoin metier est simple :

- l'utilisateur mobile voit ses propres KPI ;
- le mobile ne transmet pas d'`utilisateur_id` ;
- le mobile ne transmet pas de `country` pour cette route ;
- l'identite vient du JWT ;
- les compteurs sont calcules uniquement pour l'utilisateur connecte.

La confusion venait du fait qu'Edukia est multi-pays et que beaucoup de routes
GET acceptent `?country=...`. Pour ce dashboard personnel, ce parametre n'a pas
de sens fonctionnel cote mobile.

## Decision finale

La route personnelle est :

```http
GET /dashboard/moi/activite?jours=28
Authorization: Bearer <access_token>
```

Regle appliquee :

- consultations : filtrees par `resource_access.utilisateur_id` ;
- soumissions : filtrees par `epreuve_submissions.soumis_par_id` ;
- streak : filtre par `login_events.utilisateur_id` ;
- quotas : lus pour l'utilisateur connecte, avec la configuration du pays de son compte.

Le pays du compte (`utilisateurs.pays`) sert seulement a charger la regle de
quota applicable. Il ne sert pas a couper les compteurs personnels.

## Reponse API

La reponse conserve les champs historiques au premier niveau et ajoute l'objet
`kpis` pour l'integration mobile.

Exemple de structure :

```json
{
  "jours": [
    { "date": "2026-09-08", "acces": 0 },
    { "date": "2026-09-09", "acces": 2 }
  ],
  "streak_jours": 1,
  "derniere_connexion": "2026-09-14T09:05:55.527Z",
  "epreuves_consultees": 3,
  "examens_nationaux_consultes": 0,
  "concours_consultes": 0,
  "ressources_academiques_consultees": 3,
  "soumissions": 22,
  "kpis": {
    "epreuves_consultees": 3,
    "examens_nationaux_consultes": 0,
    "concours_consultes": 0,
    "ressources_academiques_consultees": 3,
    "quota_ressources_utilise": 0,
    "quota_ressources_restant": 5,
    "quota_ressources_pourcentage": 0,
    "quota_ketsia_utilise": 0,
    "quota_ketsia_restant": 1,
    "quota_ketsia_pourcentage": 0,
    "soumissions": 22,
    "streak_jours": 1,
    "derniere_connexion": "2026-09-14T09:05:55.527Z"
  },
  "quotas": {
    "RESOURCE_VIEW": {
      "used": 0,
      "limit": 5,
      "remaining": 5,
      "pourcentage": 0
    },
    "KETSIA_AI": {
      "used": 0,
      "limit": 1,
      "remaining": 1,
      "pourcentage": 0
    }
  }
}
```

La reponse n'expose pas de champ `pays`, car le mobile n'a pas besoin de
piloter ou afficher ce scope pour les KPI personnels.

## Fichiers modifies

- `backend/src/dashboard/dashboard.controller.ts`
- `backend/src/dashboard/dashboard.service.ts`
- `backend/src/dashboard/dashboard.service.spec.ts`
- `backend/src/main.ts`
- `doc/api-dashboard-personnel-mobile.md`

## Points corriges

- La route personnelle ne depend plus de `@CurrentCountry()`.
- Le service lit `utilisateurs.pays` uniquement pour la configuration de quota.
- Les compteurs d'activite ne filtrent plus par pays.
- Swagger n'ajoute plus `country` sur `GET /dashboard/moi/activite`.
- La documentation mobile indique clairement de ne pas envoyer `country`.

## Verification

Tests passes :

```bash
npm run build
npm test -- dashboard.service.spec.ts --runInBand
```

Test API reel effectue :

1. Creation d'un utilisateur test au Senegal via `POST /utilisateurs/inscription?country=senegal`.
2. Connexion via `POST /auth/connexion`.
3. Appel mobile sans pays : `GET /dashboard/moi/activite?jours=7`.
4. Reponse `200 OK` avec `kpis`, `jours.length = 7`, et sans champ `pays`.
5. Appel avec `country=benin` envoye par erreur : reponse toujours `200 OK`.
6. Nettoyage des comptes test via `DELETE /utilisateurs`.

## Conclusion

Issue abattue : les KPI personnels mobile sont maintenant calcules pour
l'utilisateur connecte, et rien d'autre.
