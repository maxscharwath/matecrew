Maté Consumption Tracking Web App (MateCrew)

1. Contexte et objectif

Créer une application web simple (Next.js envisagé) pour enregistrer la consommation de canettes de Maté au sein de l’entreprise et faciliter la logistique quotidienne.

Objectifs principaux :
	•	Chaque jour à 10:00, publier un message Slack avec un lien/bouton pour déclarer « je veux un maté ». ::hiveTranscript{{timestamp=33}}
	•	Centraliser la liste des demandes du jour pour qu’une personne puisse distribuer/livrer les canettes. ::hiveTranscript{{timestamp=41}}
	•	Tenir un registre de consommation par personne pour calculer les montants à rembourser lors de commandes groupées. ::hiveTranscript{{timestamp=71}}
	•	Déployer gratuitement sur Vercel. ::hiveTranscript{{timestamp=93}}
	•	Ajouter un login (avec évolution vers SSO Microsoft). ::hiveTranscript{{timestamp=105}}
	•	Support multi-bureaux (Lausanne, Genève, etc.) avec un channel Slack par bureau.
	•	Gérer le stock et envoyer une alerte quand il devient bas.
	•	Tracer les achats (qui a commandé / payé) et calculer les remboursements.
	•	Archiver les factures (upload) lors des refills.

2. Périmètre

Inclus :
	•	Demande quotidienne, distribution, registre de consommation.
	•	Multi-bureaux + configuration Slack par bureau.
	•	Stock par bureau + alertes.
	•	Achats/refills + factures.
	•	Calcul des remboursements (périodique) et vues de synthèse.
	•	Administration complète depuis l’app (heure d’envoi, channels, webhooks, seuil stock, etc.).

Exclus (version 1) :
	•	Intégrations avancées Slack (interactivité via Slack App + signatures), paiement en ligne.

3. Rôles et permissions
	•	Employé : peut déclarer une demande du jour, consulter son historique et ses montants.
	•	Runner du jour : peut voir la liste des demandes du jour (par bureau) et marquer « servi ».
	•	Admin (restreint) : configure bureaux, Slack, horaires, stock, achats, remboursements, utilisateurs.

4. Modèle de données (conceptuel)
	•	Office(id, name, timezone, slackWebhookUrl, slackChannelLabel, dailyPostTime, lowStockThreshold)
	•	User(id, displayName, username, passwordHash?, officeId, role)
	•	DailyRequest(id, date, officeId, userId, status: requested|served, createdAt)
	•	Stock(officeId, currentQty)
	•	PurchaseBatch(id, officeId, purchasedAt, orderedByUserId, paidByUserId, qty, unitPrice, totalPrice, notes)
	•	InvoiceFile(id, purchaseBatchId, storageKey, filename, mimeType, uploadedAt)
	•	ConsumptionEntry(id, officeId, userId, date, qty, source: dailyRequest|manual, purchaseBatchId?, createdAt)
	•	ReimbursementPeriod(id, officeId, startDate, endDate, closedAt?)
	•	ReimbursementLine(periodId, fromUserId, toUserId, amount, currency)

Notes :
	•	Les entrées de consommation peuvent être générées automatiquement à partir des demandes « served ».
	•	Le rattachement à un batch peut être : (a) FIFO automatique, (b) manuel, (c) par période.

5. Flux principaux

5.1 Demande quotidienne
	1.	Cron Vercel déclenche le job à l’heure configurée par bureau.
	2.	Job poste sur Slack (via webhook) un message Block Kit avec un bouton/lien vers l’app (paramètres: office + date + token).
	3.	L’utilisateur ouvre l’app et clique « Je veux un maté ».
	4.	La demande est enregistrée pour la date du jour et le bureau.

5.2 Distribution
	1.	Le runner ouvre l’écran « Aujourd’hui ».
	2.	Il voit la liste (par bureau) des demandeurs.
	3.	Il marque chaque demande comme « served ».
	4.	Le stock diminue et une ConsumptionEntry est créée.

5.3 Refill / achat
	1.	Admin enregistre un PurchaseBatch (quantité, prix, qui a commandé, qui a payé).
	2.	Admin upload la facture.
	3.	Stock du bureau augmente.

5.4 Remboursements
	1.	À intervalle (mensuel typiquement), admin lance un calcul pour la période.
	2.	Le système calcule la part due par utilisateur sur base des consommations et du coût unitaire.
	3.	Génère des lignes « A doit X à B » (payer = paidByUserId des batches concernés ou une règle).
	4.	Affiche un résumé + export (CSV/PDF optionnel).

6. Spécifications par écran

6.1 Écran 1 — Login

Objectif : authentifier les utilisateurs.
	•	V1 : username + mot de passe.
	•	Évolution : ajout Microsoft SSO (Azure AD / Entra ID) sans refactor majeur.
	•	Critères :
	•	Session sécurisée.
	•	Rôle et bureau accessibles après login.

6.2 Écran 2 — Sélection / contexte bureau

Objectif : travailler dans le bon bureau.
	•	Si l’utilisateur a un bureau unique : auto.
	•	Sinon : sélecteur (Lausanne, Genève, …).

6.3 Écran 3 — Demande du jour

Objectif : déclarer « je veux un maté ».
	•	État :
	•	Bouton « Demander un maté » si non demandé.
	•	Confirmation + possibilité d’annuler (option).
	•	Affiche : date du jour, bureau, statut.

6.4 Écran 4 — Runner (liste du jour)

Objectif : liste claire des demandes du jour.
	•	Liste des demandeurs (tri: non-servi d’abord).
	•	Actions rapides :
	•	Marquer « servi » / « non servi ».
	•	Compteur total du jour.
	•	Filtre par bureau (si admin multi-bureaux).
	•	Option export/print.

6.5 Écran 5 — Dashboard utilisateur

Objectif : transparence individuelle.
	•	Historique consommation (par jour / période).
	•	Total consommé sur période.
	•	Estimation due (si calcul actif) et/ou historique des remboursements.

6.6 Écran 6 — Admin > Bureaux & Slack

Objectif : administrer l’automatisation Slack.
	•	CRUD bureaux.
	•	Config par bureau :
	•	webhook Slack,
	•	label/channel,
	•	heure d’envoi quotidienne,
	•	seuil stock bas,
	•	timezone.
	•	Test webhook (bouton « envoyer message test »).

6.7 Écran 7 — Admin > Stock

Objectif : suivi stock temps réel.
	•	Stock actuel par bureau.
	•	Historique des mouvements (consommations + achats + ajustements manuels).
	•	Alerte stock bas :
	•	badge visuel,
	•	envoi Slack au channel bureau (ou channel admin).

6.8 Écran 8 — Admin > Achats / Refills

Objectif : enregistrer commandes groupées.
	•	Formulaire : bureau, date, qty, prix unitaire, total, commandé par, payé par, notes.
	•	Upload facture (PDF/image) + visualisation + download.
	•	Impact stock : +qty.

6.9 Écran 9 — Admin > Remboursements

Objectif : calcul et synthèse.
	•	Choix période (start/end) + bureau.
	•	Génération :
	•	tableau par utilisateur (consommé, coût, dû),
	•	lignes de remboursement (from/to/amount),
	•	net par utilisateur.
	•	Export : CSV (minimum), PDF (option).
	•	Option « clôturer période » (fige les chiffres).

7. Exigences non-fonctionnelles
	•	UX rapide (1 clic pour demander).
	•	Sécurité : hash mot de passe, sessions, RBAC.
	•	Auditabilité : historique immutable des achats + factures.
	•	Performance : pages principales < 1s perçue.
	•	Observabilité minimale : logs + erreurs.

8. Tech stack recommandée (Vercel)
	•	Frontend/Backend : Next.js (App Router) + Server Actions/Route Handlers.
	•	Auth : Auth.js / NextAuth
	•	Credentials Provider (V1)
	•	Azure AD / Microsoft Entra ID Provider (V2)
	•	DB : Postgres (Neon ou Supabase)
	•	ORM : Prisma
	•	Storage factures : Cloudflare R2 (S3 compatible) + URLs signées
	•	Cron : Vercel Cron
	•	Slack : Incoming Webhooks + Block Kit (bouton vers URL de l’app)
	•	UI : Tailwind + shadcn/ui

9. MVP (ordre d’implémentation)
	1.	Auth (credentials) + modèle User/Office.
	2.	Bureaux + config Slack + cron quotidien (message + lien).
	3.	Écran demande du jour + enregistrement.
	4.	Écran runner + marquage servi + consumption + stock.
	5.	Achats/refills + stock + upload facture.
	6.	Dashboard utilisateur.
	7.	Remboursements + export.
	8.	Ajout Microsoft SSO.