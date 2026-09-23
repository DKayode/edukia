import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { MethodePaiement, PrestatairePaiement } from '../shared/paiement.enums';

export class InitierPaiementDto {
  /**
   * L'abonnement à payer. Exclusif de `commande_uuid` : on paie soit un
   * abonnement pour soi, soit un lot de codes à distribuer.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4', { message: "L'abonnement doit être identifié par un UUID" })
  abonnement_uuid?: string;

  /** La commande groupée à payer. Exclusif de `abonnement_uuid`. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4', { message: 'La commande doit être identifiée par un UUID' })
  commande_uuid?: string;

  @ApiPropertyOptional({ enum: PrestatairePaiement })
  @IsOptional()
  @IsEnum(PrestatairePaiement)
  prestataire?: PrestatairePaiement;

  @ApiPropertyOptional({ enum: MethodePaiement })
  @IsOptional()
  @IsEnum(MethodePaiement)
  methode?: MethodePaiement;

  @IsOptional()
  @IsString()
  @Length(6, 30)
  telephone?: string;
}
