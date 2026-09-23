import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreerCommandeCodesDto {
  @ApiProperty({ description: 'Le plan acheté, en autant d’exemplaires que `quantite`.' })
  @IsString()
  @IsUUID('4', { message: 'plan_uuid doit être un identifiant valide' })
  plan_uuid: string;

  @ApiProperty({
    example: 10,
    description:
      'Nombre de codes à engendrer. Au-delà de 500, c’est une commande sur mesure — le montant ' +
      'et la logistique ne relèvent plus du libre-service.',
  })
  @Type(() => Number)
  @IsInt({ message: 'La quantité doit être un entier' })
  @Min(1, { message: 'La quantité doit être d’au moins 1' })
  @Max(500, { message: 'Au-delà de 500 codes, contactez-nous' })
  quantite: number;
}
