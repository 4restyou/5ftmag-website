// 5ft.mag 카메라 브랜드 사전 + 정규화
//
// 사용자 자유 입력 카메라명("Leica M6", "라이카 M6", "M6" 등)을 동일 모델로
// 묶기 위한 사전. 브랜드 prefix 를 제거한 뒤 model 키로 그룹화한다.
//
// 처리 순서:
//   1) 입력 정리 (trim · lowercase · 공백 단일화 · 괄호/점/슬래시 제거)
//   2) 브랜드 + 공백 prefix 매칭  (예: "Leica M6")
//   3) 브랜드 + 공백 없는 prefix 매칭 — 단 남은 부분에 숫자 포함  (예: "니콘D750")
//   4) 브랜드 못 찾았으면 MODEL_BRAND_HINTS 로 모델→브랜드 추정 (예: "Lomomatic", "오토보이")
//      - 3자 이상 모델 키는 prefix 매칭, 1~2자 키는 정확 일치만 (false-positive 차단)
//
// 새 카메라 모델/브랜드가 들어오는데 사전에 없는 게 자주 보이면:
//   - 브랜드 자체가 누락 → CAMERA_BRANDS 에 추가
//   - 브랜드명 없이 모델만 적히는 게 자주 보임 → MODEL_BRAND_HINTS 에 추가
//   - 사이트 안에서 처리하려면 /admin/camera-brands.html 사용
(function () {
  'use strict';

  const CAMERA_BRANDS = [
    ['leica',        '라이카'],
    ['canon',        '캐논'],
    ['nikon',        '니콘'],
    ['pentax',       '펜탁스', 'asahi pentax', 'asahi'],
    ['olympus',      '올림푸스'],
    ['minolta',      '미놀타'],
    ['contax',       '콘탁스'],
    ['yashica',      '야시카'],
    ['mamiya',       '마미야', 'mamiyaflex'],
    ['hasselblad',   '핫셀블라드', '핫셀'],
    ['rollei',       '롤라이', 'rolleiflex', 'rolleicord'],
    ['voigtländer',  'voigtlander', '보이그랜더', '보이그란더', '포익트랜더'],
    ['bronica',      '브로니카', 'zenza bronica', 'zenza'],
    ['fujifilm',     'fuji', 'fujica', '후지', '후지필름'],
    ['konica',       '코니카'],
    ['ricoh',        '리코'],
    ['lomography',   'lomo', '로모', '로모그래피'],
    ['polaroid',     '폴라로이드'],
    ['holga',        '홀가'],
    ['kodak',        '코닥'],
    ['plaubel',      '플라우벨'],
    ['linhof',       '린호프'],
    ['zeiss',        'zeiss ikon', '자이스', '자이스 이콘', 'carl zeiss', '짜이스'],
    ['zorki',        '조르키'],
    ['fed',          '페드'],
    ['kiev',         '키예프'],
    ['lubitel',      '류비텔'],
    ['smena',        '스메나'],
    ['zenit',        'zenith', '제니트'],
    ['krasnogorsk',  '크라스노고르스크'],
    ['praktica',     '프락티카'],
    ['exakta',       '엑사크타', '엑사타'],
    ['pentacon',     '펜타콘'],
    ['cosina',       '코시나'],
    ['chinon',       '치논'],
    ['vivitar',      '비비타'],
    ['petri',        '페트리'],
    ['topcon',       '톱콘'],
    ['bessa',        '베사'],
    ['superheadz',   '슈퍼헤즈'],
  ];

  // 브랜드명 없이도 자주 입력되는 모델들 → 브랜드 추정.
  // 매칭은 modelKey() 로 정규화한 뒤 prefix 비교 (모델 키 길이 ≥ 3 에 한해).
  // 짧은 키(1~2자)는 정확 일치만 — 'm6', 't2' 같은 짧은 모델이 다른 모델 prefix 로 잘못 매칭되는 것 방지.
  const MODEL_BRAND_HINTS = [
    {
      brand: 'leica',
      models: [
        // M-mount (film only — 디지털 M 제외)
        'm6', 'm6ttl', 'm6classic', 'm7', 'mp', 'ma',
        // Barnack screw-mount
        'iiia', 'iiib', 'iiic', 'iiid', 'iiif', 'iiig',
        // R-series SLR
        'leicaflex', 'r3', 'r4', 'r4s', 'r5', 'r6', 'r62', 'r7', 'r8', 'r9',
        // Compact
        'minilux', 'miniluxzoom', 'cmzoom', 'afc1', 'z2x',
      ],
    },
    {
      brand: 'canon',
      models: [
        // FD SLR
        'ae1', 'aeprogram', 'a1canon', 'at1', 'av1', 'al1',
        't50', 't60', 't70', 't80', 't90',
        'ftb', 'newf1',
        // EOS film
        'eos1', 'eos1n', 'eos1nrs', 'eos1v', 'eos3', 'eos5', 'eos10', 'eos30', 'eos33',
        'eos50', 'eos55', 'eos100',
        'eos300', 'eos500', 'eos600', 'eos620', 'eos630', 'eos650', 'eos700', 'eos750',
        'eos850', 'eos1000', 'eos1000f', 'eos3000', 'eos5000', 'eos7e',
        'elan', 'elan7', 'elan7e', 'elan7n',
        'rebel', 'rebel2000', 'rebelti', 'rebelk2', 'rebelt2', 'rebelgii', 'rebelxs',
        // Rangefinder
        'canonet', 'canonetql17', 'canonetgiii', 'canonetgiiiql17', 'canonet28',
        // Half-frame Demi
        'demi', 'demiee', 'demiee17', 'demiee28',
        // Compact
        '오토보이', 'autoboy', 'autoboy2', 'autoboy3', 'autoboyf', 'autoboyd5',
        'autoboyprisma', 'autoboyjuno', 'autoboyluna', 'autoboytele', 'autoboyzoom',
        'autoboyepoca',
        'sureshot', 'sureshotsupreme', 'sureshotmax', 'sureshotace', 'sureshotzoom',
        'sureshottelemax', 'sureshotaf7', 'sureshotmultitele',
        'prima', 'primashot', 'primamini', 'primasuper', 'primazoom', 'primaas1',
        'snappy', 'snappy20', 'snappy50',
        'af35m', 'af35ml', 'af35mii',
        // APS film
        'eosix', 'eosixe', 'pronea600i', 'pronea6i', 'proneas',
        // 추가 P&S
        'photura', 'epoca', 'autoboyjet',
        'sprint', 'af35j', 'autoboylite',
        'autoboybf80', 'sureshot80tele', 'primabftwin',
        // ELPH / IXUS / IXY (APS film)
        'ixus', 'ixusii', 'ixusiii', 'elph', 'elph2', 'ixy320',
      ],
    },
    {
      brand: 'nikon',
      models: [
        // F-series pro
        'f2', 'f3', 'f3hp', 'f3p', 'f3t', 'f4', 'f4s', 'f4e', 'f5', 'f6',
        // FM/FE/FA
        'fm', 'fm2', 'fm2n', 'fm10', 'fm3a',
        'fe', 'fe2', 'fe10', 'fa',
        'em', 'fg', 'fg20',
        // Nikkormat
        'nikkormat', 'nikkormatft', 'nikkormatftn', 'nikkormatft2', 'nikkormatft3',
        'nikkormatel', 'nikkormatelw', 'nikomat', 'nikomatft', 'nikomatftn', 'el2',
        // AF film
        'f301', 'f501', 'f601', 'f401', 'f801', 'f801s', 'f90', 'f90x', 'f100',
        'f50', 'f55', 'f60', 'f65', 'f70', 'f75', 'f80',
        'n2000', 'n2020', 'n4004', 'n5005', 'n6000', 'n6006', 'n8008', 'n8008s',
        'n50', 'n55', 'n60', 'n65', 'n70', 'n75', 'n80', 'n90', 'n90s',
        // Compact
        '35ti', '28ti',
        'l35af', 'l35af2', 'l35af3', 'l35aw', 'pikaichi', '피카이치',
        'onetouch', 'litetouch', 'litetouchzoom', 'zoomtouch400', 'zoomtouch500',
        // Nikonos (underwater)
        'nikonos', 'nikonosii', 'nikonosiii', 'nikonosiv', 'nikonosiva', 'nikonosv', 'nikonosrs',
        // 추가 P&S
        'tw2', 'tw2d', 'tw20', 'teletouchdeluxe', 'teletouch300',
        'twzoom', 'twzoom85', 'zoomtouch600',
        'af400', 'af600', 'minitouch', 'litetouchaf',
        'actiontouch', 'l35aw', 'l35awaf',
      ],
    },
    {
      brand: 'pentax',
      models: [
        // K-mount manual
        'k1000', 'kx', 'km', 'k2pentax',
        'mx', 'me', 'mesuper', 'mef', 'lx',
        'superprogram', 'supera', 'programa', 'programplus', 'p30', 'p50',
        'spotmatic', 'spotmaticf', 'spotmaticii', 'asahiflex',
        // MZ / ZX
        'mz3', 'mz5', 'mz5n', 'mz6', 'mz7', 'mz10', 'mz30', 'mz50', 'mz60', 'mzm', 'mzs',
        'zx3', 'zx5', 'zx5n', 'zx7', 'zx10', 'zx30', 'zx50', 'zxl', 'zxm',
        'z1', 'z1p', 'z10', 'z20', 'z70', 'pz1', 'pz1p', 'pz10', 'pz20', 'pz70',
        // Medium format
        'pentax67', '67ii', '6x7', 'pentax645', '645n', '645nii',
        // Compact
        'espio', 'espiomini', 'espio105wr', 'espio140', 'espio120', 'espio115', 'espio738',
        'pc35af', 'pc35afm', 'auto110', 'pino35', 'uc1',
        'pentax17',
        // IQZoom P&S 라인
        'iqzoom60', 'iqzoom70', 'iqzoom70xl', 'iqzoom80', 'iqzoom90',
        'iqzoom105', 'iqzoom115', 'iqzoom140', 'iqzoom200',
        'iqzoom928', 'iqzoom170sl',
        'iqzoomezy', 'iqzoomezy80', 'iqzoomezyr', 'iqzoomezys',
        'espio80', 'espio80v', 'espio90mc', 'iqzoom90mc',
      ],
    },
    {
      brand: 'olympus',
      models: [
        // OM SLR
        'om1', 'om1n', 'om1md', 'om2', 'om2n', 'om2sp', 'om3', 'om3ti', 'om4', 'om4ti', 'om4tib',
        'om10', 'om20', 'om30', 'om40', 'omg', 'omf', 'om101', 'om707', 'om2000',
        // Pen half-frame
        'pen', 'pens', 'pend', 'penw', 'penee', 'penee2', 'penee3', 'peneed', 'penees', 'penees2',
        'penem', 'penef', 'penf', 'penft', 'penfv', 'penrapid',
        // mju / Stylus
        'mju', 'mjuii', 'mjuiii', 'mjuzoom105', 'mjuzoom115', 'mju170', 'mju110', 'mu2',
        'stylus', 'stylusepic', 'styluszoom105', 'styluszoom115', 'stylusepiczoom',
        'stylus100wide', 'stylus150', 'stylus80',
        // XA / Trip
        'xa', 'xa1', 'xa2', 'xa3', 'xa4',
        'trip35',
        // Classic 35-series
        '35rc', '35sp', '35ed', '35dc', '35rd', '35lc',
        'infinity', 'infinitystylus',
        // 추가 P&S
        'tripaf', 'tripaf50',
        'af1', 'af1twin', 'af10', 'af10twin', 'af10super',
        'ecru', 'oproduct',
        'is1', 'is2', 'is3', 'is10', 'is1000', 'is2000', 'is3000',
        'is100', 'is200', 'is300', 'is500', 'is21', 'centurion',
        'quickshooter', 'quickshooterzoom',
        'infinityjr', 'infinitys',
        'infinitysuperzoom3000', 'infinitysuperzoom330',
        'superzoom70g', 'superzoom3000',
        'stylusepiczoom80', 'styluszoom140',
        'newpicaf200',
      ],
    },
    {
      brand: 'minolta',
      models: [
        // SR mount manual
        'sr1', 'sr2', 'sr3', 'sr7', 'srm',
        'srt100', 'srt101', 'srt102', 'srt201', 'srt202', 'srt303', 'srtsuper',
        'x700', 'x500', 'x570', 'x300', 'x370', 'x9minolta',
        'xd', 'xd5', 'xd7', 'xd11', 'xe1', 'xe5', 'xe7',
        'xg1', 'xg2', 'xg7', 'xg9', 'xgm', 'xga',
        'xkminolta',
        // A-mount AF
        'maxxum', 'maxxum7', 'maxxum9', 'maxxum50', 'maxxum70',
        'dynax', 'dynax7', 'dynax9', 'dynax30', 'dynax40', 'dynax60',
        // Compact
        'himatic', 'himatic7', 'himatic7s', 'himatic9', 'himatic11', 'himatice', 'himaticf',
        'himaticg', 'himatics', 'himaticsd', 'himaticaf',
        'tc1', 'cle', 'autocord',
        'freedom', 'riva', 'rivamini', 'rivazoom70w', 'capios',
        'freedomescort', 'freedomzoom', 'freedomvista', 'rivapanorama',
        // 추가 P&S
        'afsv', 'talker', 'aftele', 'aftelesuper', 'afc', 'afs', 'afe',
        'rivazoom90ex', 'rivazoom140ex', 'rivazoompico',
        'freedomactionzoom', 'freedomautodatezoom',
      ],
    },
    {
      brand: 'contax',
      models: [
        't2', 't3', 'tvs', 'tvsii', 'tvsiii',
        'g1', 'g2',
        'rts', 'rtsii', 'rtsiii', '139q', '139quartz', '159mm', '167mt', '137ma', '137md',
        'aria', 's2b', 'ax', 'rx', 'rxii',
        'n1contax', 'nx',
        'contax645',
        // pre-war
        'iia', 'iiia',
        // APS
        'tix',
      ],
    },
    {
      brand: 'rollei',
      models: [
        // TLR
        'rolleiflex', 'rolleicord',
        '3.5e', '3.5f', '2.8c', '2.8d', '2.8e', '2.8f', '2.8gx', '2.8fx',
        'telerolleiflex', 'wideanglerolleiflex', 'babyrolleiflex',
        'rolleicordi', 'rolleicordii', 'rolleicordiii', 'rolleicordiv',
        'rolleicordv', 'rolleicordva', 'rolleicordvb',
        // 35mm Rollei 35 family
        'rollei35', 'rollei35t', 'rollei35s', 'rollei35te', 'rollei35se',
        'b35rollei', 'c35rollei',
        'rolleimat', 'rolleimataf', 'pregoaf', 'afm35',
        // Prego 시리즈 + 후기 컴팩트
        'prego90', 'prego125', 'prego140', 'pregozoom',
        'a26', 'a110', 'xf35', 'sportsline35',
        // SLR
        'sl35', 'sl35e', 'sl35m', 'sl350', 'sl2000f', 'sl3001', 'sl3003',
        // MF SLR
        'sl66', 'sl66e', 'sl66se',
        '6002', '6003', '6006', '6008',
      ],
    },
    {
      brand: 'voigtländer',
      models: [
        'bessal', 'bessat', 'bessar', 'bessar2', 'bessar2a', 'bessar2m', 'bessar2s',
        'bessar2c', 'bessar3a', 'bessar3m', 'bessar4a', 'bessar4m',
        'vito', 'vitob', 'vitoc', 'vitoii', 'vitoiii', 'vitoautomatic',
        'vitomatic', 'vitomatici', 'vitomaticii', 'vitomaticiii', 'vitoret',
        'vitessa', 'vitessat',
        'prominent', 'prominentii',
        'bessamatic', 'bessamaticdeluxe', 'bessamaticcs', 'ultramatic',
        'perkeo', 'perkeoi', 'perkeoii', 'perkeoe',
      ],
    },
    {
      brand: 'hasselblad',
      models: [
        '1600f', '1000f',
        '500c', '500cm', '500el', '500elm', '500elx', '553elx', '555eld',
        '501c', '501cm',
        '503cx', '503cxi', '503cw', '503cwd',
        '2000fc', '2000fcm', '2000fcw', '2003fcw',
        '201f', '202fa', '203fe', '205fcc', '205tcc',
        'swc', 'swcm', '903swc', '905swc',
        'xpan', 'xpanii',
      ],
    },
    {
      brand: 'mamiya',
      models: [
        'rb67', 'rb67pro', 'rb67pros', 'rb67prosd',
        'rz67', 'rz67proii', 'rz67proiid',
        'm645', 'm645j', 'm6451000s', 'm645super', '645pro', '645protl', '645e',
        '645af', '645afd', '645afdii', '645afdiii',
        'mamiya6', 'mamiya7', '7iimamiya', '6mf',
        'mamiyaflex', 'c220', 'c220f', 'c330', 'c330f', 'c330s',
        'sxmamiya', 'xtl', 'nc1000', 'nc1000s',
        'ze2', 'zex', 'zmmamiya',
      ],
    },
    {
      brand: 'bronica',
      models: [
        'etr', 'etrc', 'etrs', 'etrsi',
        'sq', 'sqa', 'sqai', 'sqam', 'sqb',
        's2bronica', 's2a', 'ec', 'ectl', 'ectlii',
        'gs1',
        'rf645',
      ],
    },
    {
      brand: 'fujifilm',
      models: [
        // Pro 35mm
        'tx1', 'tx2',
        'klasse', 'klasses', 'klassew',
        'natura', 'naturas', 'naturablack', 'naturaclassica', 'naturans',
        // Medium format
        'ga645', 'ga645i', 'ga645zi', 'ga645w', 'ga645wi',
        'gs645', 'gs645s', 'gs645w',
        'g690', 'gl690', 'gm670',
        'gw670ii', 'gw670iii', 'gw680', 'gw680ii', 'gw680iii',
        'gw690', 'gw690ii', 'gw690iii',
        'gsw690', 'gsw690ii', 'gsw690iii', 'gsw680iii',
        'gx617', 'gx680', 'gx680ii', 'gx680iii',
        // Compact
        'tiara', 'tiaraii', 'dlsupermini',
        'silvi', 'silvi1000', 'silvi1300',
        'cardia',
        // Disposable
        'quicksnap', 'quicksnapflash', 'simpleace',
        // SLR
        'st605', 'st701', 'st705', 'st801', 'st901',
        'stx1', 'ax1', 'ax3', 'ax5', 'az1',
      ],
    },
    {
      brand: 'kodak',
      models: [
        'retina', 'retinai', 'retinaii', 'retinaiia', 'retinaiic', 'retinaiif',
        'retinaiii', 'retinaiiic', 'retinette', 'retinetteii', 'retinareflex',
        'instamatic', 'instamatic100', 'instamatic104', 'instamatic124',
        'instamatic174', 'instamatic304', 'instamatic414', 'instamaticx',
        'pocketinstamatic',
        'brownie', 'browniehawkeye', 'brownieflash', 'browniejunior',
        'browniestarmite', 'browniebullseye', 'brownie127', 'brownietarget',
        'disc4000', 'disc6000', 'disc8000',
        'signet35', 'signet30', 'signet40', 'signet50', 'signet80',
        'bantam', 'bantamspecial', 'flashbantam',
        'pony828', 'pony135', 'pony135b', 'pony135c', 'ponyii', 'ponyiv',
        'duaflex', 'duaflexii', 'duaflexiii', 'duaflexiv',
        'medalist', 'medalistii',
        'ektar', 'ektarh35', 'ektarh35n', 'h35',
        'funsaver', 'kodakfunsaver', 'maxhd', 'kodakultra', 'kodaksport', 'waterproofsport',
        'starmatic', 'starmite', 'colorsnap', 'stretch35',
      ],
    },
    {
      brand: 'polaroid',
      models: [
        'sx70', 'sx70alpha', 'sx70sonar',
        'onestep600', 'sun600', 'sun640', 'sun660', 'one600',
        '600polaroid', '636polaroid', '660polaroid', '670polaroid',
        '680polaroid', '690polaroid',
        'slr680', 'slr690', 'coolcam', 'jobpro', 'spiritlms',
        'pronto', 'prontob', 'prontosonarone',
        'landcamera', 'colorpack', 'colorpackii', 'colorpackiii', 'colorpackiv', 'colorpackv', '600se',
        'highlander',
        'spectra', 'spectra2', 'spectraonyx', 'spectrapro',
        'image', 'imageelite', 'imagepro', 'imagespectra',
        'i1', 'i2', 'now', 'nowplus', 'nowgen2', 'flippolaroid',
        'onestep2', 'onestepplus', 'onestep',
        'miopolaroid',
      ],
    },
    {
      brand: 'lomography',
      models: [
        'lomomatic', 'lomomatic110',
        'lomoapparat', 'apparat',
        'mca', 'lomomca',
        'lca', 'lcaplus', 'lca120', 'lcwide', 'lcawide', 'lcasprocket',
        'diana', 'dianaf', 'dianamini', 'dianababy', 'dianababy110',
        'dianadeluxe', 'dianainstant', 'dianainstantsquare',
        'fisheye', 'fisheye2', 'fisheyebaby',
        'spinner', 'spinner360',
        'konstruktor', 'konstruktorf',
        'belair', 'belairx', 'belair612', 'belair6x12', 'belairjetsetter',
        'sprocketrocket', 'sprocket',
        'sardina', 'lasardina',
        'hydrochrome',
        'lubitel166plus',
        'simpleuse',
        'lomokino', 'lomokinoscope',
        'lomoinstant', 'lomoinstantautomat', 'lomoinstantwide', 'lomoinstantsquare',
        'actionsampler', 'oktomat', 'supersampler', 'pop9',
        'colorsplash', 'colorsplashflash',
        'horizon', 'horizont',
      ],
    },
    {
      brand: 'zorki',
      models: [
        'zorki1', 'zorki2', 'zorki2s', 'zorki2c', 'zorki3', 'zorki3m', 'zorki3s',
        'zorki4', 'zorki4k', 'zorki5', 'zorki6', 'zorki10', 'zorki11', 'zorki12',
      ],
    },
    {
      brand: 'fed',
      models: [
        'fed1', 'fed2', 'fed3', 'fed4', 'fed5', 'fed5b', 'fed5c', 'fed5v',
        'fed10', 'fed11', 'fedatlas', 'fedmikron', 'fedmicron',
        'fedzarya',
      ],
    },
    {
      brand: 'kiev',
      models: [
        'kiev2', 'kiev2a', 'kiev3', 'kiev3a', 'kiev4', 'kiev4a', 'kiev4m', 'kiev4am', 'kiev5',
        'kiev10', 'kiev15', 'kiev17', 'kiev19', 'kiev19m', 'kiev20',
        'kiev30', 'kiev303', 'kiev35a', 'kievvega',
        'kiev60', 'kiev6c', 'kiev6s', 'kiev80', 'kiev88', 'kiev88cm',
        'salyut', 'salut',
      ],
    },
    {
      brand: 'lubitel',
      models: [
        'lubitel2', 'lubitel166', 'lubitel166b', 'lubitel166u', 'lubitel166universal',
        'lubitel166plus',
      ],
    },
    {
      brand: 'smena',
      models: [
        'smena2', 'smena2m', 'smena3', 'smena4', 'smena5', 'smena6', 'smena7',
        'smena8', 'smena8m', 'smena9', 'smena35',
        'smenarapid', 'smenasl', 'smenasymbol', 'smenam', 'cosmic35',
      ],
    },
    {
      brand: 'zenit',
      models: [
        'zenit3', 'zenit3m', 'zenit4', 'zenit5', 'zenit6', 'zenit7',
        'zenitb', 'zenite', 'zenitem', 'zenitet',
        'zenittl', 'zenitttl',
        'zenit10', 'zenit11', 'zenit12', 'zenit12sd', 'zenit12xp',
        'zenit122', 'zenit212k', 'zenit19',
        'zenit18', 'zenitautomat',
        'zenithorizon',
      ],
    },
    {
      brand: 'praktica',
      models: [
        'prakticafx', 'prakticafx2', 'prakticafx3', 'prakticaiv', 'prakticav',
        'prakticavi', 'prakticavii', 'prakticanova', 'prakticanovab',
        'prakticasuper', 'prakticasupertl',
        'prakticaltl', 'prakticaltl2', 'prakticaltl3', 'prakticallc',
        'prakticalb', 'prakticalb2', 'prakticaplc',
        'prakticamtl', 'prakticamtl2', 'prakticamtl3', 'prakticamtl5', 'prakticamtl50',
        'prakticab100', 'prakticab200', 'prakticabc1', 'prakticabca', 'prakticabcs',
        'prakticabms', 'prakticabx20', 'prakticabx20s',
      ],
    },
    {
      brand: 'exakta',
      models: [
        'kineexakta', 'exaktaii', 'exaktav', 'exaktavx',
        'exaktavarex', 'exaktavarexvx', 'exaktavarexiia', 'exaktavarexiib',
        'exaktavx1000', 'exaktavx500',
        'exa', 'exai', 'exaia', 'exaib', 'exa500',
        'exaktarealist', 'exaktarealistii',
      ],
    },
    {
      brand: 'pentacon',
      models: [
        'pentaconsix', 'pentaconsixtl', 'pentaconf', 'pentaconfm', 'pentaconfb',
        'pentaconsuper', 'pentaconauto', 'pentaconetrl', 'pentaconettl',
      ],
    },
    {
      brand: 'yashica',
      models: [
        'fx1', 'fx2', 'fx3', 'fx3super', 'fx3super2000', 'fx7', 'fx7super',
        'fx103', 'fx107', 'fxd',
        'electro35', 'electro35g', 'electro35gt', 'electro35gs', 'electro35gsn',
        'electro35gtn', 'electro35gl', 'electro35cc', 'electro35ccn', 'electro35pro',
        'mat', 'mat124', 'mat124g', 'mat124b',
        't2yashica', 't3yashica', 't4', 't4super', 't5', 't4zoom', 'tprozoom',
        'samurai', 'samuraix3', 'samuraix4',
        // 추가 P&S (Kyocera-era)
        '230af', 'super230af', '270af', '300af', 'afj',
      ],
    },
    {
      brand: 'konica',
      models: [
        'hexar', 'hexarrf', 'hexaraf', 'hexarsilver', 'hexarclassic', 'hexargold',
        'autoreflex', 'autoreflext', 'autoreflextc', 'autoreflexta',
        'ft1', 'fs1', 'fc1', 'fp1', 'tcx',
        'bigmini', 'bm201', 'bm300', 'bm301', 'bm302', 'bigminif',
        'bm310z', 'bm311z', 'bm411z', 'bm510z', 'bm610z',
        'autos', 'autos2', 'autos3',
        'c35', 'c35v', 'c35automatic', 'c35el', 'c35ef', 'c35fd',
        // MR / Z-up / 기타 P&S
        'mr70', 'mr70lx', 'mr640',
        'zup28w', 'zup60', 'zup70', 'zup70vp', 'zup70super',
        'zup80', 'zup80rclimited',
        'zup110super', 'zup120vp',
        'zup130', 'zup135super', 'zup140super',
        'zup150', 'zup150vp',
        'aiborg', 'genbakantoku', 'genbakantokudd',
      ],
    },
    {
      brand: 'ricoh',
      models: [
        'gr1', 'gr1s', 'gr1v', 'gr10', 'gr21',
        'kr5', 'kr5super', 'kr5sv', 'kr10', 'kr10x', 'kr10se',
        'xr1', 'xr1s', 'xr2', 'xr2s', 'xr5', 'xr6', 'xr7', 'xr8', 'xr8super',
        'xrs', 'xrf', 'xrsolar',
        'xr500', 'xr1000', 'xr1000s', 'xr2000',
        'ff1', 'ff9',
        'r1ricoh', 'r1s', 'r1e', 'r10ricoh',
        'mirai',
        // 추가 P&S
        'ff3af', 'ff3dap', 'ff3afsuper',
        'ff7', 'ff7d', 'ff9s',
        'shotmasterafsuper', 'onetakeafsuper',
        'shotmasterzoom', 'shotmasterzoomsuper',
        'shotmastertruzoom', 'rz900', 'myportzoom90',
        'shotmasterultrazoomsuper',
      ],
    },
    {
      brand: 'holga',
      models: [
        'holga120', 'holga120n', 'holga120s', 'holga120sf', 'holga120fn',
        'holga120cfn', 'holga120gn', 'holga120gcfn',
        'holga120pc', 'holga120wpc', 'holga120pan', 'holga1203d', 'holga120tlr',
        'holga135', 'holga135bc', 'holga135tim', 'holga135pan',
        'holgawpc', 'holgapinhole', 'holgawide',
      ],
    },
    {
      brand: 'vivitar',
      models: [
        'uws', 'ultrawideslim', 'vivitarwide', 'vivitarslim', 'vivitarpinhole',
      ],
    },
    {
      brand: 'superheadz',
      models: [
        'goldenhalf', 'blackslimdevil', 'whiteslimangel', 'yellowpeace', 'blueribbon',
        'rainbow',
      ],
    },
  ];

  // 입력 → [trim, lowercase, 공백 단일화, 괄호/점/슬래시 제거]
  function pre(s) {
    return String(s ?? '')
      .trim()
      .toLowerCase()
      .replace(/[+()/.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 모델 키 정규화 (alias 비교용) — 공백/하이픈/언더스코어 모두 제거
  function modelKey(s) {
    return String(s ?? '').toLowerCase().replace(/[\s\-_]/g, '');
  }

  // input → { key, brand, original }
  function normalizeCamera(input) {
    const original = String(input ?? '');
    const trimmed = pre(original);
    if (!trimmed) return { key: '', brand: null, original };

    // 가장 긴 alias 우선 매칭 (예: 'asahi pentax' > 'asahi' > 'pentax')
    const flat = [];
    for (const [canonical, ...aliases] of CAMERA_BRANDS) {
      flat.push([canonical, canonical]);
      for (const a of aliases) flat.push([canonical, a.toLowerCase()]);
    }
    flat.sort((a, b) => b[1].length - a[1].length);

    let brand = null;
    let rest = trimmed;
    let brandMatched = false;
    for (const [canonical, form] of flat) {
      if (rest === form) {
        return { key: '', brand: canonical, original };
      }
      // 1) 공백 있는 prefix
      if (rest.startsWith(form + ' ')) {
        rest = rest.slice(form.length + 1).trim();
        brand = canonical;
        brandMatched = true;
        break;
      }
      // 2) 공백 없는 prefix — 남은 부분에 숫자 포함된 경우만
      if (rest.startsWith(form) && rest.length > form.length) {
        const after = rest.slice(form.length).trim();
        if (after && /\d/.test(after)) {
          rest = after;
          brand = canonical;
          brandMatched = true;
          break;
        }
      }
    }

    // 3) 브랜드 매칭 실패 → MODEL_BRAND_HINTS 로 모델로부터 브랜드 추정
    //    - 3자 이상 키만 prefix 매칭, 1~2자 키는 정확 일치만 (false-positive 차단)
    if (!brandMatched) {
      const mk = modelKey(rest);
      outer: for (const hint of MODEL_BRAND_HINTS) {
        for (const m of hint.models) {
          const mNorm = modelKey(m);
          if (!mNorm) continue;
          const isExact = (mk === mNorm);
          const isPrefix = (mNorm.length >= 3 && mk.startsWith(mNorm));
          if (isExact || isPrefix) {
            brand = hint.brand;
            break outer;
          }
        }
      }
    }

    const key = modelKey(rest);
    return { key, brand, original };
  }

  // 같은 model 키의 후보 표기들 중 표시용 1개를 고름.
  // 정책: 가장 많이 등장한 원본 (count 동률이면 더 긴 것, 또 동률이면 첫 등장)
  function pickDisplay(originals) {
    if (!originals || !originals.length) return '';
    const tally = new Map();
    for (const s of originals) {
      const key = String(s ?? '').trim();
      if (!key) continue;
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    let best = '';
    let bestScore = -1;
    for (const [s, c] of tally) {
      const score = c * 10000 + s.length;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  window.normalizeCamera = normalizeCamera;
  window.pickCameraDisplay = pickDisplay;
  window.CAMERA_BRANDS = CAMERA_BRANDS;
  window.MODEL_BRAND_HINTS = MODEL_BRAND_HINTS;
})();
