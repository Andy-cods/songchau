import { db, schema } from './index'
// import { eq } from 'drizzle-orm'

// Product Categories Data
const categories = [
  { name: 'SMT Nozzles', slug: 'nozzle', icon: 'Target', sortOrder: 1 },
  { name: 'SMT Feeder Parts', slug: 'feeder', icon: 'Layers', sortOrder: 2 },
  { name: 'SMT Spare Parts', slug: 'spare-parts', icon: 'Wrench', sortOrder: 3 },
  { name: 'SMT Machines', slug: 'machine', icon: 'Factory', sortOrder: 4 },
  { name: 'Soldering & Rework', slug: 'solder-tool', icon: 'Flame', sortOrder: 5 },
  { name: 'Dispensing Equipment', slug: 'dispensing', icon: 'Pipette', sortOrder: 6 },
  { name: 'ESD & Cleanroom', slug: 'esd', icon: 'Shield', sortOrder: 7 },
  { name: 'Electronic Components', slug: 'electronic-component', icon: 'Cpu', sortOrder: 8 },
  { name: 'Electric & Automatic Tools', slug: 'electric-tool', icon: 'Zap', sortOrder: 9 },
  { name: 'Microscopes', slug: 'microscope', icon: 'Search', sortOrder: 10 },
  { name: 'Label & Ribbon', slug: 'label', icon: 'Tag', sortOrder: 11 },
  { name: 'Tweezers & Pliers', slug: 'tweezers', icon: 'Scissors', sortOrder: 12 },
  { name: 'Fume Extractors', slug: 'fume-extractor', icon: 'Wind', sortOrder: 13 },
]

// ALL Nozzle Products Data
const nozzleProducts = [
  // Panasonic AM100
  { partNumber: '256M', name: '256M', spec: '0.39×0.3', material: 'CERAMIC', remark: '0402', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '225M', name: '225M', spec: '0.6×0.35', material: 'CERAMIC', remark: '0603', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '226M', name: '226M', spec: '0.6×0.5', material: 'CERAMIC', remark: '0603,1005', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '230M', name: '230M', spec: '1.0×0.6', material: 'CERAMIC', remark: '1005,1608', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '235M', name: '235M', spec: '1.6×0.8', material: 'CERAMIC', remark: '1608~3216', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '387M', name: '387M', spec: '1.6×1.1', material: 'CERAMIC', remark: '3216,4532', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '120MT', name: '120MT', spec: 'Φ1.3/Φ0.9', material: 'METAL', remark: '2012,3216', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '240MT', name: '240MT', spec: 'Φ2.4/Φ1.8', material: 'METAL', remark: '3216,4532', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '260M', name: '260M', spec: 'Φ5.0/Φ3.0', material: 'METAL', remark: 'TAN', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '184MTR', name: '184MTR', spec: 'Φ6.0/Φ4.0', material: 'METAL', remark: 'SOP,QFP', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '140M', name: '140M', spec: 'Φ4.0', material: 'RUBBER', remark: 'IC', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '185M', name: '185M', spec: 'Φ6.0', material: 'RUBBER', remark: 'QFP,PLCC', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '388M', name: '388M', spec: 'Φ7.0', material: 'RUBBER', remark: 'QFP,PLCC', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '389M', name: '389M', spec: 'Φ8.0', material: 'RUBBER', remark: 'QFP,PLCC', brand: 'Panasonic', model: 'AM100' },
  { partNumber: '199MR', name: '199MR', spec: 'Φ10.0', material: 'RUBBER', remark: 'Large Component', brand: 'Panasonic', model: 'AM100' },

  // Panasonic NPM
  { partNumber: 'KXFX037UA00', name: '110', spec: '110', material: 'CERAMIC', remark: '', brand: 'Panasonic', model: 'NPM' },
  { partNumber: 'KXFX03DJA00', name: '115', spec: '115', material: 'CERAMIC', remark: '', brand: 'Panasonic', model: 'NPM' },
  { partNumber: 'KXFX0383A00', name: '120', spec: '120', material: 'CERAMIC', remark: '', brand: 'Panasonic', model: 'NPM' },
  { partNumber: 'KXFX0384A00', name: '130', spec: '130', material: 'CERAMIC', remark: '', brand: 'Panasonic', model: 'NPM' },
  { partNumber: 'KXFX0385A00', name: '140', spec: '140', material: 'METAL', remark: '', brand: 'Panasonic', model: 'NPM' },
  { partNumber: 'KXFX0386A00', name: '150', spec: '150', material: 'METAL', remark: '', brand: 'Panasonic', model: 'NPM' },
  { partNumber: 'KXFX055PA00', name: '160', spec: '160', material: 'RUBBER', remark: '', brand: 'Panasonic', model: 'NPM' },
  { partNumber: 'KXFX03E4A00', name: '170', spec: '170', material: 'RUBBER', remark: '', brand: 'Panasonic', model: 'NPM' },
  { partNumber: 'KXFX03E3A00', name: '180', spec: '180', material: 'RUBBER', remark: '', brand: 'Panasonic', model: 'NPM' },
  { partNumber: 'KXFX05FKA00', name: '190', spec: '190', material: 'RUBBER', remark: '', brand: 'Panasonic', model: 'NPM' },
  { partNumber: 'KXFX05FLA00', name: '200', spec: '200', material: 'RUBBER', remark: '', brand: 'Panasonic', model: 'NPM' },

  // Fuji NXT-H04
  { partNumber: 'AA06W00', name: 'Φ1.0', spec: 'Φ1.0/Φ0.7', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA06X00', name: 'Φ1.3', spec: 'Φ1.3/Φ1.0', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA06Y00', name: 'Φ1.8', spec: 'Φ1.8', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA06Z00', name: 'Φ2.5', spec: 'Φ2.5', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA07F00', name: 'Φ2.5G', spec: 'Φ2.5', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA07A00', name: 'Φ3.7', spec: 'Φ3.7', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA0G00', name: 'Φ3.7G', spec: 'Φ3.7', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA07B00', name: 'Φ5.0', spec: 'Φ5.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA0H00', name: 'Φ5.0G', spec: 'Φ5.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA07C00', name: 'Φ7.0', spec: 'Φ7.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA07K00', name: 'Φ7.0G', spec: 'Φ7.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA07D00', name: 'Φ10.0', spec: 'Φ10.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H04' },
  { partNumber: 'AA07L00', name: 'Φ10.0G', spec: 'Φ10.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H04' },

  // Fuji NXT-H04S
  { partNumber: 'AA8TE00', name: 'Φ1.3', spec: 'Φ1.3/Φ1.0', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H04S' },
  { partNumber: 'AA8WW00', name: 'Φ1.8', spec: 'Φ1.8', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H04S' },
  { partNumber: 'AA8WX00', name: 'Φ2.5', spec: 'Φ2.5', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H04S' },
  { partNumber: 'AA8XA00', name: 'Φ2.5G', spec: 'Φ2.5', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H04S' },
  { partNumber: 'AA93W00', name: 'Φ3.7', spec: 'Φ3.7', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H04S' },
  { partNumber: 'AA8XB00', name: 'Φ3.7G', spec: 'Φ3.7', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H04S' },
  { partNumber: 'AA93X00', name: 'Φ5.0', spec: 'Φ5.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H04S' },
  { partNumber: 'AA8XC00', name: 'Φ5.0G', spec: 'Φ5.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H04S' },
  { partNumber: 'AA93Y00', name: 'Φ7.0', spec: 'Φ7.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H04S' },
  { partNumber: 'AA8XD00', name: 'Φ7.0G', spec: 'Φ7.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H04S' },

  // Fuji NXT AIM-H08M
  { partNumber: 'AA8DX00', name: 'Φ0.7', spec: 'Φ0.7/Φ0.4', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8LT00', name: 'Φ1.0', spec: 'Φ1.0/Φ0.7', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8DY00', name: 'Φ1.3', spec: 'Φ1.3/Φ1.0', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8LW00', name: 'Φ1.8', spec: 'Φ1.8', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8LX00', name: 'Φ2.5', spec: 'Φ2.5', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8ME00', name: 'Φ2.5G', spec: 'Φ2.5', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8LY00', name: 'Φ3.7', spec: 'Φ3.7', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8MF00', name: 'Φ3.7G', spec: 'Φ3.7', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8LZ00', name: 'Φ5.0', spec: 'Φ5.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8MG00', name: 'Φ5.0G', spec: 'Φ5.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8MA00', name: 'Φ7.0', spec: 'Φ7.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8MH00', name: 'Φ7.0G', spec: 'Φ7.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8MB00', name: 'Φ10.0', spec: 'Φ10.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },
  { partNumber: 'AA8MK00', name: 'Φ10.0G', spec: 'Φ10.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT AIM-H08M' },

  // Fuji NXT M-III 24HEAD
  { partNumber: '2AGKNX005203', name: 'Φ0.3', spec: 'Φ0.3', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT M-III 24HEAD' },
  { partNumber: '2AGKNX005303', name: 'Φ0.4', spec: 'Φ0.4', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT M-III 24HEAD' },
  { partNumber: '2AGKNX005502', name: 'Φ0.5', spec: 'Φ0.5', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT M-III 24HEAD' },
  { partNumber: '2AGKNX003106', name: 'Φ0.7', spec: 'Φ0.7', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT M-III 24HEAD' },
  { partNumber: '2AGKNX003504', name: 'Φ1.0', spec: 'Φ1.0', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT M-III 24HEAD' },
  { partNumber: '2AGKNX001703', name: 'Φ1.3', spec: 'Φ1.3', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT M-III 24HEAD' },
  { partNumber: '2AGKNX003703', name: 'Φ1.8', spec: 'Φ1.8', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT M-III 24HEAD' },
  { partNumber: '2AGKNX003903', name: 'Φ2.5', spec: 'Φ2.5', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT M-III 24HEAD' },

  // Fuji NXT-H08, H12
  { partNumber: 'AA1AT00', name: 'Φ0.3', spec: 'Φ0.4/Φ0.25', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA05600', name: 'Φ0.4', spec: '0.4×0.3', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA05700', name: 'Φ0.7', spec: 'Φ0.7/Φ0.38', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA05800', name: 'Φ1.0', spec: 'Φ1.0/Φ0.7', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA20A00', name: 'Φ1.3', spec: 'Φ1.3/Φ1.0', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA20B00', name: 'Φ1.8', spec: 'Φ1.8', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA20C01', name: 'Φ2.5', spec: 'Φ2.5', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA0WT00', name: 'Φ2.5G', spec: 'Φ2.5', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA20D00', name: 'Φ3.7', spec: 'Φ3.7', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA18C00', name: 'Φ3.7G', spec: 'Φ3.7', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA20E00', name: 'Φ5.0', spec: 'Φ5.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },
  { partNumber: 'AA06300', name: 'Φ5.0G', spec: 'Φ5.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H08, H12' },

  // Fuji NXT-H01, H02
  { partNumber: 'AA0AS00', name: 'Φ1.0', spec: 'Φ1.0/Φ0.7', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA06800', name: 'Φ1.3', spec: 'Φ1.3/Φ1.0', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA0HL00', name: 'Φ1.8', spec: 'Φ1.8', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA0HM00', name: 'Φ2.5', spec: 'Φ2.5', material: 'CERAMIC', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA08410', name: 'Φ2.5G', spec: 'Φ2.5', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA0HN00', name: 'Φ3.7', spec: 'Φ3.7', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA08500', name: 'Φ3.7G', spec: 'Φ3.7', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA0HR01', name: 'Φ5.0', spec: 'Φ5.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA07200', name: 'Φ5.0G', spec: 'Φ5.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA08000', name: 'Φ7.0', spec: 'Φ7.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA07310', name: 'Φ7.0G', spec: 'Φ7.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA08100', name: 'Φ10.0', spec: 'Φ10.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA07410', name: 'Φ10.0G', spec: 'Φ10.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA08200', name: 'Φ15.0', spec: 'Φ15.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA07510', name: 'Φ15.0G', spec: 'Φ15.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA08300', name: 'Φ20.0', spec: 'Φ20.0', material: 'METAL', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },
  { partNumber: 'AA07610', name: 'Φ20.0G', spec: 'Φ20.0', material: 'RUBBER', remark: '', brand: 'Fuji', model: 'NXT-H01, H02' },

  // Casio YCM-7000/7700/7800/8800
  { partNumber: 'H03/H3M', name: 'H03/H3M', spec: '0.4×0.5/Φ0.25', material: 'CERAMIC', remark: '0603', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'HS1/H1M', name: 'HS1/H1M', spec: 'Φ0.7/Φ0.38', material: 'CERAMIC', remark: '1005', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'H2/H2M', name: 'H2/H2M', spec: 'Φ1.1/Φ0.65', material: 'CERAMIC', remark: '1608', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'H06', name: 'H06', spec: 'Φ1.2/Φ0.9', material: 'CERAMIC', remark: '', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'H7', name: 'H7', spec: 'Φ2.0/Φ1.4', material: 'CERAMIC', remark: '3216', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'H21 MELF', name: 'H21 MELF', spec: 'Φ0.8/Φ0.45', material: 'CERAMIC', remark: 'MELF', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'H22 MELF', name: 'H22 MELF', spec: 'Φ1.2/Φ0.9', material: 'CERAMIC', remark: 'MELF', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'H23 MELF', name: 'H23 MELF', spec: 'Φ2.0/Φ1.4', material: 'CERAMIC', remark: 'MELF', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'T7', name: 'T7', spec: 'Φ2.0/Φ1.4', material: 'CERAMIC', remark: '', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'T06', name: 'T06', spec: 'Φ1.6/Φ1.0', material: 'CERAMIC', remark: '', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'T21 MELF', name: 'T21 MELF', spec: 'Φ0.8/Φ0.45', material: 'CERAMIC', remark: '', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'T22 MELF', name: 'T22 MELF', spec: 'Φ1.2/Φ0.9', material: 'CERAMIC', remark: '', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },
  { partNumber: 'T23 MELF', name: 'T23 MELF', spec: 'Φ2.1/Φ1.4', material: 'CERAMIC', remark: '', brand: 'Casio', model: 'YCM-7000,7700,7800,8800' },

  // Yamaha YSM40
  { partNumber: 'KLF-M87A0-A0', name: '510A', spec: '0.25×0.35(□)', material: 'CERAMIC', remark: '0402', brand: 'Yamaha', model: 'YSM40' },
  { partNumber: 'KLF-M8710-A0', name: '511A', spec: '0.35×0.75(□)', material: 'CERAMIC', remark: '0603', brand: 'Yamaha', model: 'YSM40' },
  { partNumber: 'KLF-M8720-A0', name: '512A', spec: '1.2×0.45(□)', material: 'CERAMIC', remark: '1005', brand: 'Yamaha', model: 'YSM40' },
  { partNumber: 'KLF-M8730-A1', name: '513A', spec: '1.3×2.0(±)', material: 'CERAMIC', remark: '2012', brand: 'Yamaha', model: 'YSM40' },
  { partNumber: 'KLF-M7710-A0', name: '501A', spec: '0.8×0.7(X)', material: 'CERAMIC', remark: '1005', brand: 'Yamaha', model: 'YSM40' },
  { partNumber: 'KLF-M7720-A0', name: '502A', spec: '1.0×1.7(X)', material: 'CERAMIC', remark: '1608', brand: 'Yamaha', model: 'YSM40' },
  { partNumber: 'KLF-M8740-A0', name: '503A/514A', spec: 'Φ4.0/3.0×2.0', material: 'METAL', remark: '', brand: 'Yamaha', model: 'YSM40' },
  { partNumber: 'KLF-M8750-A0', name: '504A/515A', spec: 'Φ8.0', material: 'O-RING', remark: '', brand: 'Yamaha', model: 'YSM40' },

  // Yamaha/Hitachi Σ-G4, Σ-G5
  { partNumber: 'HG21C---', name: 'HG21C/HG22C', spec: '0.5×0.3', material: 'CERAMIC', remark: '0402', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HG32C---', name: 'HG31C/HG32C/HG33C', spec: '0.7×0.4', material: 'CERAMIC', remark: '0603', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HV32C---', name: 'HV31C/HV/32C', spec: '0.7×0.4', material: 'CERAMIC', remark: '0603', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HG52C---', name: 'HG51C/HG52C/HG53C', spec: '1.1×0.6', material: 'CERAMIC', remark: '1005', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HV51C---', name: 'HV51C/HV52C', spec: '1.1×0.6', material: 'CERAMIC', remark: '1005', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HG82C---', name: 'HG81C/HG82C/HG83C', spec: '1.7×0.9', material: 'CERAMIC', remark: '1608', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HV82C---', name: 'HV81C/HV82C', spec: '1.7×0.9', material: 'CERAMIC', remark: '1608', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HV13C---', name: 'HV13C/HV03C', spec: 'Φ1.3/Φ0.9', material: 'CERAMIC', remark: '2012', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HV14C---', name: 'HV14C/HA04C', spec: 'Φ1.8/Φ1.1', material: 'CERAMIC', remark: '3216', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HV15C---', name: 'HV15C/HA05C', spec: 'Φ3.0/Φ2.0', material: 'METAL', remark: '4523', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HV19C---', name: 'HV19C/HA09C', spec: 'Φ6.0/Φ4.5', material: 'METAL', remark: 'SOP', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HB03C---', name: 'HB03C', spec: 'Φ1.3/Φ0.9', material: 'METAL', remark: '2012~3216 MELF', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },
  { partNumber: 'HB04C---', name: 'HB04C', spec: 'Φ1.8/Φ1.1', material: 'METAL', remark: '3216~5922 MELF', brand: 'Yamaha/Hitachi', model: 'Σ-G4, Σ-G5' },

  // Yamaha/Hitachi GXH-1, GXH-3
  { partNumber: '630 137 5472', name: 'HA11', spec: '0.5×0.3', material: 'CERAMIC', remark: '0402', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 152 8267', name: 'HV31/HV32', spec: '0.7×0.4', material: 'CERAMIC', remark: '0603', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 158 6571', name: 'HG31/HG32', spec: '0.7×0.4', material: 'CERAMIC', remark: '0603', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 128 4842', name: 'HA10', spec: '0.7×0.4', material: 'CERAMIC', remark: '0603', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 152 8472', name: 'HV51/HV52', spec: '1.1×0.6', material: 'CERAMIC', remark: '1005', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 159 9632', name: 'HG51/HG52', spec: '1.1×0.6', material: 'CERAMIC', remark: '1005', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 129 2878', name: 'HV01', spec: 'Φ0.6/Φ0.4', material: 'CERAMIC', remark: '1005', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 132 2322', name: 'PV01', spec: '1.1×0.6', material: 'CERAMIC', remark: '1005', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 158 9084', name: 'HV81/HV82', spec: '1.7×0.9', material: 'CERAMIC', remark: '1608', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 161 3501', name: 'HG81/HG82', spec: '1.7×0.9', material: 'CERAMIC', remark: '1608', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 129 2885', name: 'HV02', spec: 'Φ0.9/Φ0.7', material: 'CERAMIC', remark: '1608', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 129 2892', name: 'HV03', spec: 'Φ1.3/Φ0.9', material: 'CERAMIC', remark: '2012~2125', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 129 2922', name: 'HV04', spec: 'Φ1.8/Φ1.1', material: 'CERAMIC', remark: '3216', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 129 2908', name: 'HB03', spec: 'Φ1.3/Φ0.9', material: 'METAL', remark: '2012 MELF', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 129 2922-HA04', name: 'HA04', spec: 'Φ1.8/Φ1.1', material: 'METAL', remark: '3216', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },
  { partNumber: '630 129 2915', name: 'HB04', spec: 'Φ1.8/Φ1.1', material: 'METAL', remark: '3216 MELF', brand: 'Yamaha/Hitachi', model: 'GXH-1, GXH-3' },

  // ASM/Siemens 900 series (12HEAD)
  { partNumber: '00322603', name: '901', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00348186', name: '902', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00322602', name: '904', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00345031', name: '911', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00345020', name: '913', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00321861', name: '914', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00321862', name: '915', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00321863', name: '917', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00321864', name: '918', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00321867', name: '919', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00325972', name: '920', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00325970', name: '921', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00324996', name: '923', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00321866', name: '924', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00333652', name: '925', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00346522', name: '932', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00346523', name: '933', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00327810', name: '934', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00346524', name: '935', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00352353', name: '936', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00322591', name: '937', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00322592', name: '938', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00322593', name: '939', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00330533', name: '951', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00330534', name: '952', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00330535', name: '953', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00330536', name: '954', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00330537', name: '955', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },
  { partNumber: '00330538', name: '956', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '900 series 12HEAD' },

  // ASM/Siemens 1000 series (20HEAD)
  { partNumber: '03013307-01', name: '1001', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03015869-01', name: '1003', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03015840-01', name: '1004', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03015854-01', name: '1006', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03013300-01', name: '1011', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03013303-01', name: '1014', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03014327-01', name: '1032', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03013425-01', name: '1033', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03013103-01', name: '1034', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03015194-01', name: '1035', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03014331-01', name: '1036', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03014336-01', name: '1133', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03015384-01', name: '1135', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
  { partNumber: '03015222-01', name: '1235', spec: '', material: '', remark: '', brand: 'ASM/Siemens', model: '1000 series 20HEAD' },
]

// Non-nozzle product items
const nonNozzleProducts = [
  // Spare Parts
  { partNumber: 'SP-BELT-001', name: 'Conveyor Belt', category: 'spare-parts', subcategory: 'Belt' },
  { partNumber: 'SP-FEEDER-001', name: 'Feeder Assembly', category: 'feeder', subcategory: 'Feeder' },
  { partNumber: 'SP-CYL-001', name: 'Pneumatic Cylinder', category: 'spare-parts', subcategory: 'Cylinder' },
  { partNumber: 'SP-FILTER-001', name: 'Air Filter', category: 'spare-parts', subcategory: 'Filter' },
  { partNumber: 'SP-BEARING-001', name: 'Ball Bearing', category: 'spare-parts', subcategory: 'Bearing' },
  { partNumber: 'SP-MOTOR-001', name: 'Servo Motor', category: 'spare-parts', subcategory: 'Motor' },
  { partNumber: 'SP-SENSOR-001', name: 'Proximity Sensor', category: 'spare-parts', subcategory: 'Sensor' },

  // Machines
  { partNumber: 'MCH-PRINTER-001', name: 'Solder Paste Printer', category: 'machine', subcategory: 'Printer' },
  { partNumber: 'MCH-REFLOW-001', name: 'Reflow Oven', category: 'machine', subcategory: 'Oven' },
  { partNumber: 'MCH-PNP-001', name: 'Pick and Place Machine', category: 'machine', subcategory: 'PNP' },

  // Soldering Tools
  { partNumber: 'SOL-STATION-001', name: 'Soldering Station', category: 'solder-tool', subcategory: 'Station' },
  { partNumber: 'SOL-REWORK-001', name: 'Rework Station', category: 'solder-tool', subcategory: 'Rework' },
  { partNumber: 'SOL-TIP-001', name: 'Soldering Tip Set', category: 'solder-tool', subcategory: 'Tips' },

  // Dispensing
  { partNumber: 'DISP-CTRL-001', name: 'Dispensing Controller', category: 'dispensing', subcategory: 'Controller' },
  { partNumber: 'DISP-NEEDLE-001', name: 'Dispensing Needle Set', category: 'dispensing', subcategory: 'Needle' },

  // ESD & Cleanroom
  { partNumber: 'ESD-MAT-001', name: 'ESD Table Mat', category: 'esd', subcategory: 'Mat' },
  { partNumber: 'ESD-STRAP-001', name: 'ESD Wrist Strap', category: 'esd', subcategory: 'Strap' },
  { partNumber: 'ESD-BAG-001', name: 'ESD Packaging Bag', category: 'esd', subcategory: 'Packaging' },
  { partNumber: 'CLEAN-WIPER-001', name: 'Cleanroom Wiper', category: 'esd', subcategory: 'Cleanroom' },

  // Electronic Components
  { partNumber: 'IC-SAMSUNG-001', name: 'Samsung IC Component', category: 'electronic-component', subcategory: 'IC', brand: 'Samsung' },
  { partNumber: 'CAP-MURATA-001', name: 'Murata Capacitor', category: 'electronic-component', subcategory: 'Capacitor', brand: 'Murata' },
  { partNumber: 'RES-YAGEO-001', name: 'YAGEO Resistor', category: 'electronic-component', subcategory: 'Resistor', brand: 'YAGEO' },

  // Microscopes
  { partNumber: 'MICRO-001', name: 'Digital Microscope', category: 'microscope', subcategory: 'Digital' },
  { partNumber: 'MICRO-PART-001', name: 'Microscope Lens', category: 'microscope', subcategory: 'Parts' },

  // Labels & Ribbons
  { partNumber: 'LABEL-WAX-001', name: 'Wax Ribbon', category: 'label', subcategory: 'Ribbon' },
  { partNumber: 'LABEL-RESIN-001', name: 'Resin Ribbon', category: 'label', subcategory: 'Ribbon' },
  { partNumber: 'LABEL-PAPER-001', name: 'Paper Label', category: 'label', subcategory: 'Label' },
  { partNumber: 'LABEL-PRINTER-001', name: 'Label Printing Machine', category: 'label', subcategory: 'Printer' },

  // Tweezers & Pliers
  { partNumber: 'TWEEZER-001', name: 'Precision Tweezers', category: 'tweezers', subcategory: 'Tweezers' },
  { partNumber: 'PLIER-001', name: 'Cutting Pliers', category: 'tweezers', subcategory: 'Pliers' },

  // Fume Extractors
  { partNumber: 'FUME-SOL-001', name: 'Solder Fume Extractor', category: 'fume-extractor', subcategory: 'Soldering' },
  { partNumber: 'FUME-LEAD-001', name: 'Cut Lead Extractor', category: 'fume-extractor', subcategory: 'Lead' },
]

async function seed() {
  console.log('🌱 Starting database seed...')

  try {
    // 1. Seed Product Categories
    console.log('📦 Seeding product categories...')
    for (const cat of categories) {
      await db.insert(schema.productCategories).values(cat).onConflictDoNothing()
    }
    console.log(`✓ Seeded ${categories.length} categories`)

    // 2. Seed Nozzle Products
    console.log('🎯 Seeding nozzle products...')
    let nozzleCount = 0
    for (const nozzle of nozzleProducts) {
      await db.insert(schema.products).values({
        partNumber: nozzle.partNumber,
        name: nozzle.name,
        category: 'nozzle',
        brand: nozzle.brand,
        machineModel: nozzle.model,
        material: nozzle.material || '',
        size: nozzle.spec || '',
        remark: nozzle.remark || '',
        isConsumable: true,
        status: 'active',
      }).onConflictDoNothing()
      nozzleCount++
    }
    console.log(`✓ Seeded ${nozzleCount} nozzle products`)

    // 3. Seed Non-Nozzle Products
    console.log('📦 Seeding non-nozzle products...')
    let otherCount = 0
    for (const product of nonNozzleProducts) {
      await db.insert(schema.products).values({
        partNumber: product.partNumber,
        name: product.name,
        category: product.category,
        subcategory: product.subcategory,
        brand: product.brand || null,
        status: 'active',
      }).onConflictDoNothing()
      otherCount++
    }
    console.log(`✓ Seeded ${otherCount} non-nozzle products`)

    // 4. Verify total count
    const totalProducts = await db.select().from(schema.products)
    const totalCategories = await db.select().from(schema.productCategories)

    console.log('\n✅ Database seeded successfully!')
    console.log(`   📊 Total Categories: ${totalCategories.length}`)
    console.log(`   📊 Total Products: ${totalProducts.length}`)
    console.log(`      - Nozzles: ${nozzleCount}`)
    console.log(`      - Other products: ${otherCount}`)

  } catch (error) {
    console.error('❌ Seed failed:', error)
    throw error
  }
}

// Run seed
seed()
  .then(() => {
    console.log('\n🎉 Seed completed!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Seed failed:', error)
    process.exit(1)
  })
