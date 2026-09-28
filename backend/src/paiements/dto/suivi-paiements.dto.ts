import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export const ISSUES_PAIEMENT = ['ABOUTI', 'NON_ABOUTI'] as const;
export type IssuePaiement = (typeof ISSUES_PAIEMENT)[number];

export class SuiviPaiementsDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ISSUES_PAIEMENT,
    description: "ABOUTI : au moins un paiement réussi sur la période ; NON_ABOUTI : des tentatives, aucune réussie",
  })
  @IsOptional()
  @IsIn(ISSUES_PAIEMENT)
  issue?: IssuePaiement;

  @ApiPropertyOptional({ description: 'Tentatives créées à partir de cette date (incluse)', example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  depuis?: string;

  @ApiPropertyOptional({ description: 'Tentatives créées avant cette date (exclue)', example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  jusqua?: string;
}
