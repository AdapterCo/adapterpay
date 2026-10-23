import { Module } from '@nestjs/common';
import { ProductImages } from './product-images';
import { ProductsController, PublicImagesController } from './products.controller';

@Module({ controllers: [ProductsController, PublicImagesController], providers: [ProductImages], exports: [ProductImages] })
export class ProductsModule {}
