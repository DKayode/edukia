import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors, BadRequestException, Res, Request, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiBearerAuth,
    ApiBody,
    ApiConsumes,
    ApiOperation,
    ApiParam,
    ApiQuery,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FilesService } from './files.service';
import { UploadUrlRequestDto } from './dto/upload-url.dto';
import { FILE_FIELD_REGISTRY } from './registry';
import { EntitlementService, Feature } from '../abonnements/entitlement.service';
import { QuotaService } from '../abonnements/quota.service';
import { ProfilIncompletException, QuotaDepasseException, QuotaGratuitNonEligibleException } from '../abonnements/quota.guard';
import { FeatureQuota } from '../abonnements/entities/quota-consommation.entity';
import { ResourceAccessService } from '../resource-access/resource-access.service';

// Derived from the registry so Swagger stays in sync when slots change.
// All entities that expose at least one file slot.
const KNOWN_ENTITIES = Object.keys(FILE_FIELD_REGISTRY);
// Every slot key across all entities (deduped), for the :slot param enum.
const KNOWN_SLOTS = [
    ...new Set(Object.values(FILE_FIELD_REGISTRY).flatMap((slots) => Object.keys(slots))),
];
// Human-readable "entity → slot (visibility)" listing for the param docs.
const ENTITY_SLOT_LISTING = Object.entries(FILE_FIELD_REGISTRY)
    .map(([entity, slots]) =>
        `${entity}: ${Object.entries(slots)
            .map(([slot, cfg]) => `${slot} (${cfg.public ? 'public' : 'private'})`)
            .join(', ')}`,
    )
    .join('; ');
const ENTITY_PARAM_DESC = `Owning entity table. One of: ${ENTITY_SLOT_LISTING}.`;
const SLOT_PARAM_DESC = `Slot key for the chosen entity. Valid (entity → slots): ${ENTITY_SLOT_LISTING}.`;

@ApiTags('files')
@Controller('files')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FilesController {
    private readonly logger = new Logger(FilesController.name);

    constructor(
        private readonly filesService: FilesService,
        private readonly entitlement: EntitlementService,
        private readonly quotas: QuotaService,
        private readonly resourceAccess: ResourceAccessService,
    ) { }

    @Get('registry')
    @ApiOperation({
        summary: 'Discover supported (entity, slot) pairs and their extension allowlists',
        description:
            'Returns the full file-slot registry: which entities accept uploads, which ' +
            'slots each entity exposes (e.g. categories.icone, parcours.covert + content), ' +
            'and the list of extensions allowed on each slot. Clients should fetch this ' +
            'once at startup and cache it; the contract changes rarely. Use the keys here ' +
            'to construct calls to /files/:entity/:uuid/:slot/upload-url and ' +
            '/files/:entity/:uuid/:slot/download-url.',
    })
    @ApiResponse({
        status: 200,
        description: 'Registry as a nested map: entity → slot → { authorized: string[] }.',
        schema: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                additionalProperties: {
                    type: 'object',
                    properties: {
                        authorized: { type: 'array', items: { type: 'string' } },
                    },
                },
            },
            example: {
                categories: { icone: { authorized: ['jpg', 'jpeg', 'png', 'webp', 'avif'] } },
                concours: { file: { authorized: ['pdf'] } },
                etablissements: { logo: { authorized: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'svg'] } },
                parcours: {
                    covert: { authorized: ['jpg', 'jpeg', 'png', 'webp', 'avif'] },
                    content: { authorized: ['jpg', 'jpeg', 'png', 'webp', 'avif'] },
                },
            },
        },
    })
    getRegistry() {
        return this.filesService.getPublicRegistry();
    }

    @Post(':entity/:uuid/:slot/upload-url')
    @ApiOperation({
        summary: 'Get a presigned PUT URL for direct R2 upload',
        description:
            'Validates the requested extension against the slot allowlist, ' +
            'records the path/extension on the entity row, and returns a short-lived ' +
            'presigned URL. The client PUTs bytes directly to R2 and MUST replay every ' +
            'header in `required_headers` (Content-Type always; Cache-Control too for ' +
            'public slots) — otherwise R2 rejects the PUT with SignatureDoesNotMatch.',
    })
    @ApiParam({ name: 'entity', example: 'categories', enum: KNOWN_ENTITIES, description: ENTITY_PARAM_DESC })
    @ApiParam({ name: 'uuid', description: 'UUID of the row that owns the file' })
    @ApiParam({ name: 'slot', example: 'icone', enum: KNOWN_SLOTS, description: SLOT_PARAM_DESC })
    @ApiResponse({ status: 201, description: 'Presigned URL issued.' })
    @ApiResponse({ status: 400, description: 'Extension not in the slot allowlist.' })
    @ApiResponse({ status: 404, description: 'Unknown entity/slot or row uuid not found.' })
    async createUploadUrl(
        @Param('entity') entity: string,
        @Param('uuid') uuid: string,
        @Param('slot') slot: string,
        @Body() body: UploadUrlRequestDto,
    ) {
        return this.filesService.createUploadUrl(entity, uuid, slot, body.extension);
    }

    @Post(':entity/:uuid/:slot/upload')
    @UseInterceptors(FileInterceptor('file'))
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
        },
    })
    @ApiOperation({
        summary: 'Server-proxied upload (fallback path)',
        description:
            'Accepts a multipart/form-data file under the `file` field, streams it to R2, ' +
            'and updates the entity row. Use this when the client can\'t use the presigned ' +
            'URL flow. Extension is inferred from the uploaded filename.',
    })
    @ApiParam({ name: 'entity', example: 'categories', enum: KNOWN_ENTITIES, description: ENTITY_PARAM_DESC })
    @ApiParam({ name: 'uuid', description: 'UUID of the row that owns the file' })
    @ApiParam({ name: 'slot', example: 'icone', enum: KNOWN_SLOTS, description: SLOT_PARAM_DESC })
    async proxyUpload(
        @Param('entity') entity: string,
        @Param('uuid') uuid: string,
        @Param('slot') slot: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('Missing file (field name: "file").');
        return this.filesService.proxyUpload(entity, uuid, slot, file);
    }

    @Get(':entity/:uuid/:slot/content')
    @ApiOperation({
        summary: 'Sert les octets du fichier depuis cette API (contourne le CORS du bucket)',
        description:
            "Même cible que /download-url, mais les octets transitent par l'API au lieu " +
            "d'être lus directement sur R2. Une URL présignée suffit à OUVRIR un document " +
            "dans un onglet, pas à le LIRE depuis la page : un lecteur PDF télécharge en " +
            "fetch, que le navigateur bloque faute d'en-tête CORS sur le bucket. Ce relais " +
            "évite d'avoir à maintenir une liste blanche d'origines chez Cloudflare.",
    })
    @ApiParam({ name: 'entity', example: 'epreuve_submissions', enum: KNOWN_ENTITIES, description: ENTITY_PARAM_DESC })
    @ApiParam({ name: 'uuid', description: 'UUID of the row that owns the file' })
    @ApiParam({ name: 'slot', example: 'file', enum: KNOWN_SLOTS, description: SLOT_PARAM_DESC })
    @ApiQuery({ name: 'extension', required: false, description: 'Requis pour les slots virtuels.' })
    async streamContent(
        @Param('entity') entity: string,
        @Param('uuid') uuid: string,
        @Param('slot') slot: string,
        @Res() res: Response,
        @Query('extension') extension?: string,
    ) {
        const fichier = await this.filesService.downloadBytes(entity, uuid, slot, extension);
        res.setHeader('Content-Type', fichier.contentType);
        // `inline` : le document doit s'afficher dans le lecteur intégré, pas
        // déclencher un téléchargement.
        res.setHeader('Content-Disposition', `inline; filename="${fichier.filename}"`);
        res.setHeader('Content-Length', String(fichier.body.length));
        res.send(fichier.body);
    }

    @Get(':entity/:uuid/:slot/download-url')
    @ApiOperation({
        summary: 'Get a presigned GET URL for a private slot (public slots → 400)',
        description:
            'PRIVATE slots only. Reads the path/extension recorded on the entity row and ' +
            'returns a presigned GET URL valid for PRESIGN_DOWNLOAD_TTL_SECONDS (default ' +
            '10 min). Returns 400 for a public slot — read its URL directly from the ' +
            'entity\'s <slot>_path field. Returns 404 if no file has been uploaded yet. ' +
            'Private slots: epreuves.file, concours.file, prestataires.identity, ' +
            'kessiah_documents.file, kessiah_chat_images.file. VIRTUAL slots (both ' +
            'kessiah_* slots) have no Edukia row holding the extension — the owning ' +
            'service must pass it back via ?extension=<ext>.',
    })
    @ApiParam({ name: 'entity', example: 'epreuves', enum: KNOWN_ENTITIES, description: ENTITY_PARAM_DESC })
    @ApiParam({ name: 'uuid', description: 'UUID of the row that owns the file' })
    @ApiParam({ name: 'slot', example: 'file', enum: KNOWN_SLOTS, description: SLOT_PARAM_DESC })
    @ApiQuery({
        name: 'extension',
        required: false,
        example: 'docx',
        description: 'File extension. REQUIRED for virtual slots (kessiah_documents.file, kessiah_chat_images.file); ignored otherwise.',
    })
    async createDownloadUrl(
        @Param('entity') entity: string,
        @Param('uuid') uuid: string,
        @Param('slot') slot: string,
        @Request() req?: any,
        @Query('extension') extension?: string,
    ) {
        await this.consommerQuotaSiRequis(entity, uuid, slot, req);
        return this.filesService.createDownloadUrl(entity, uuid, slot, extension);
    }

    /**
     * Quota gratuit sur les ressources académiques (#245).
     *
     * Ce contrôleur est générique — il n'a pas à connaître les abonnements. La
     * décision vient donc du registre (`quotaResourceType`), qui est la seule
     * source disant quels slots sont des ressources académiques. Sans ce
     * contrôle, `download-url` contournerait le quota posé sur
     * `/epreuves/:id/telechargement` : c'est même le SEUL chemin d'accès aux
     * examens nationaux.
     */
    private async consommerQuotaSiRequis(
        entity: string,
        uuid: string,
        slot: string,
        req?: any,
    ): Promise<void> {
        const type = FILE_FIELD_REGISTRY[entity]?.[slot]?.quotaResourceType;
        if (!type) return;

        const utilisateurId = req?.user?.utilisateurId;
        const pays = req?.country ?? 'benin';
        const feature = type === 'epreuve' ? Feature.EPREUVE_VIEW : Feature.EXAMEN_NAT_VIEW;
        const decision = await this.entitlement.check(utilisateurId, feature, req?.user?.role, pays);
        // Profil incomplet : refuser sans consommer, comme sur les épreuves.
        if (decision.reason === 'PROFIL_INCOMPLET') {
            if (!this.entitlement.verrouActif) {
                this.logger.warn(
                    `[verrou éteint] profil incomplet — utilisateur=${utilisateurId} ${entity}/${uuid} ` +
                    `(${decision.quota?.used}/${decision.quota?.limit} %)`,
                );
                return;
            }
            throw new ProfilIncompletException(feature, decision);
        }

        if (decision.reason === 'FREE_QUOTA_NOT_ELIGIBLE') {
            if (!this.entitlement.verrouActif) {
                this.logger.warn(
                    `[verrou eteint] quota appareil non eligible — utilisateur=${utilisateurId} ${entity}/${uuid}`,
                );
                return;
            }
            throw new QuotaGratuitNonEligibleException(feature);
        }

        // Voir EpreuvesController : pas de `quota` sur une décision autorisée
        // signifie qu'aucun plafond ne s'applique.
        if (decision.allowed && !decision.quota) return;

        const resourceId = await this.filesService.findRowIdByUuid(entity, uuid);
        const resultat = await this.quotas.consommer(
            utilisateurId, FeatureQuota.RESOURCE_VIEW, type, resourceId, pays,
        );

        // Journalise l'accès aux examens nationaux, jusqu'ici absents de
        // resource_access — ce qui faussait aussi le KPI 16.
        if (resultat.allowed) {
            await this.resourceAccess.log(type, resourceId, utilisateurId ?? null, pays);
            return;
        }

        if (!this.entitlement.verrouActif) {
            this.logger.warn(
                `[verrou éteint] quota épuisé — feature=${feature} utilisateur=${utilisateurId} ` +
                `${entity}/${resourceId} (${resultat.used}/${resultat.limit})`,
            );
            return;
        }
        throw new QuotaDepasseException(feature, resultat);
    }
}
