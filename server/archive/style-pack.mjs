import { parseZip, createZip } from './zip.mjs';

function getMimeType(filename = '') {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'application/octet-stream';
}

/**
 * 从 ZIP 二进制解析风格包与关联图片
 */
export function parseStyleZipBuffer(buffer) {
  const files = parseZip(buffer);
  const styles = [];
  const imageFiles = [];
  let manifestData = null;

  // 1. 分类提取文件
  for (const f of files) {
    const lowerName = f.name.toLowerCase();
    if (lowerName === 'manifest.json' || lowerName.endsWith('/manifest.json')) {
      try {
        manifestData = JSON.parse(f.data.toString('utf8'));
      } catch {}
    } else if (lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.webp')) {
      imageFiles.push(f);
    }
  }

  // 2. 提取所有合法的风格 JSON
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.json') || f.name.toLowerCase().endsWith('manifest.json')) continue;
    try {
      const text = f.data.toString('utf8');
      const parsed = JSON.parse(text);
      const s = parsed.style || parsed;

      // 必须具备风格核心要素，避免将设计说明或共享规则当成风格
      if (!s || typeof s !== 'object' || !s.style_name || !s.style_text_rules) {
        continue;
      }
      if (s.notes_not_imported_by_v041) continue;

      // 提取基准 ID（优先保留稳定 ID）
      let styleId = s.style_id;
      if (!styleId) {
        const match = f.name.match(/style[_-]?(\d{1,2})/i);
        if (match) {
          styleId = `life-map-style-${match[1].padStart(2, '0')}`;
        } else {
          styleId = `custom-style-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        }
      }

      // 提取已有图片（如果 JSON 内嵌了 Base64）
      const refImages = Array.isArray(s.style_reference_images)
        ? s.style_reference_images.map((img, idx) => ({
            id: img.id || `style-img-${Date.now()}-${idx}`,
            name: img.name || `image_${idx + 1}.png`,
            dataUrl: img.dataUrl || img.data_url || '',
            role: 'style',
            enabled: img.enabled !== false,
            order: typeof img.order === 'number' ? img.order : idx,
            sizeBytes: img.sizeBytes || img.size_bytes || 0,
            description: img.description || ''
          }))
        : [];

      // 构造标准风格包对象
      const stylePkg = {
        style_id: styleId,
        style_name: s.style_name,
        style_description: s.style_description || '导入的自定义风格',
        style_text_rules: s.style_text_rules,
        style_negative_rules: s.style_negative_rules || '',
        style_reference_images: refImages,
        style_scope: Array.isArray(s.style_scope) ? s.style_scope : ['color', 'lighting', 'atmosphere', 'pixel_density'],
        style_mode: s.style_mode || (refImages.length > 0 ? 'text_and_image' : 'text_and_image'),
        _source_file: f.name
      };

      styles.push(stylePkg);
    } catch {
      // 忽略无法解析的杂项 JSON
    }
  }

  // 3. 关联同一 ZIP 包内的外部图片文件
  for (const pkg of styles) {
    const pkgFolder = pkg._source_file ? pkg._source_file.split('/').slice(0, -1).join('/') : '';
    const styleKey = pkg.style_id.replace(/^life-map-style-/, '').toLowerCase();

    for (const imgFile of imageFiles) {
      const imgPath = imgFile.name;
      const imgFolder = imgPath.split('/').slice(0, -1).join('/');
      const imgBaseName = imgPath.split('/').pop() || '';

      // 匹配规则：1. 处于相同或子目录；2. 文件名包含风格编号/名称
      const inSameDir = pkgFolder && (imgFolder === pkgFolder || imgFolder.startsWith(pkgFolder + '/'));
      const nameMatched = styleKey && imgPath.toLowerCase().includes(styleKey);

      if (inSameDir || nameMatched) {
        // 避免重复添加
        if (!pkg.style_reference_images.some(existing => existing.name === imgBaseName)) {
          const mime = getMimeType(imgBaseName);
          const base64 = imgFile.data.toString('base64');
          pkg.style_reference_images.push({
            id: `style-img-${pkg.style_id}-${pkg.style_reference_images.length + 1}`,
            name: imgBaseName,
            dataUrl: `data:${mime};base64,${base64}`,
            role: 'style',
            enabled: true,
            order: pkg.style_reference_images.length,
            sizeBytes: imgFile.data.length,
            description: '从 ZIP 导入的风格参考图'
          });
        }
      }
    }

    // 清理临时元数据
    delete pkg._source_file;
  }

  return { styles, manifest: manifestData };
}

/**
 * 将多套风格包与所有图片打包为标准 ZIP
 */
export function createStyleZipBuffer(styles = []) {
  const files = [];

  const manifest = {
    package: 'Life_Map_Styles_Backup',
    created_at: new Date().toISOString(),
    total_styles: styles.length,
    styles_meta: styles.map(s => ({
      style_id: s.style_id,
      style_name: s.style_name,
      images_count: (s.style_reference_images || []).length,
      mode: s.style_mode || 'text_and_image'
    }))
  };
  files.push({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
  });

  files.push({
    name: 'README.md',
    data: Buffer.from(
      `# Life Map 风格包导出备份\n\n本 ZIP 包包含 ${styles.length} 套风格的文字提示词规则与参考图片，支持在 Life Map 生图工作台一键导入恢复。\n`,
      'utf8'
    )
  });

  for (let i = 0; i < styles.length; i++) {
    const s = styles[i];
    const safeName = s.style_name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5.-]/g, '_');
    const folder = `styles/${String(i + 1).padStart(2, '0')}_${safeName}`;

    // 提取并保存外部图片文件
    const cleanRefImages = [];
    const images = Array.isArray(s.style_reference_images) ? s.style_reference_images : [];

    for (let j = 0; j < images.length; j++) {
      const img = images[j];
      const imgName = img.name || `image_${j + 1}.png`;
      let imgData = null;

      if (typeof img.dataUrl === 'string' && img.dataUrl.includes('base64,')) {
        const base64Content = img.dataUrl.split('base64,')[1];
        if (base64Content) {
          try {
            imgData = Buffer.from(base64Content, 'base64');
          } catch {}
        }
      }

      if (imgData) {
        files.push({
          name: `${folder}/images/${imgName}`,
          data: imgData
        });
        cleanRefImages.push({
          ...img,
          dataUrl: img.dataUrl // 保持内嵌或按需读取
        });
      } else {
        cleanRefImages.push(img);
      }
    }

    const styleDoc = {
      schema_version: 'style-package-v1',
      exported_at: new Date().toISOString(),
      style: {
        style_id: s.style_id,
        style_name: s.style_name,
        style_description: s.style_description,
        style_text_rules: s.style_text_rules,
        style_negative_rules: s.style_negative_rules,
        style_scope: s.style_scope || ['color', 'lighting', 'atmosphere', 'pixel_density'],
        style_mode: s.style_mode || 'text_and_image',
        style_reference_images: cleanRefImages
      }
    };

    files.push({
      name: `${folder}/style.json`,
      data: Buffer.from(JSON.stringify(styleDoc, null, 2), 'utf8')
    });
  }

  return createZip(files);
}
