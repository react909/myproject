export type BusinessType = 'universal' | 'clothing' | 'cosmetics' | 'household'

export type BusinessTypePreset = {
  value: BusinessType
  title: string
  description: string
  categories: string[]
}

export const BUSINESS_TYPES: BusinessTypePreset[] = [
  {
    value: 'universal',
    title: 'Универсальный магазин',
    description: 'Смешанный ассортимент товаров',
    categories: ['Продукты', 'Напитки', 'Бытовая химия', 'Разное'],
  },
  {
    value: 'clothing',
    title: 'Одежда и обувь',
    description: 'Магазин одежды, обуви и аксессуаров',
    categories: ['Мужская одежда', 'Женская одежда', 'Обувь', 'Аксессуары'],
  },
  {
    value: 'cosmetics',
    title: 'Косметика и парфюмерия',
    description: 'Косметика, парфюмерия и уход',
    categories: ['Косметика', 'Парфюмерия', 'Уход за телом', 'Уход за волосами'],
  },
  {
    value: 'household',
    title: 'Хозтовары',
    description: 'Хозяйственные и бытовые товары',
    categories: ['Бытовая химия', 'Посуда', 'Инструменты', 'Разное'],
  },
]
