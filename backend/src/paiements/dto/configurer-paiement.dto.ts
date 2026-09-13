import { IsBoolean, IsEnum, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { ModePaiement, PrestatairePaiement } from '../shared/paiement.enums';

export class ConfigurerPaiementDto {
  @IsEnum(PrestatairePaiement)
  prestataire: PrestatairePaiement;

  @IsOptional()
  @IsEnum(ModePaiement)
  mode?: ModePaiement;

  @IsOptional()
  @IsString()
  devise?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  montant_min?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  montant_max?: number | null;

  @IsOptional()
  @IsBoolean()
  est_actif?: boolean;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;
}
