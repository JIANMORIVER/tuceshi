import {deflateSync, inflateSync} from 'node:zlib';
import {validatePng, chunk} from '../image-card/png.mjs';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * 将 8-bit Alpha 通道提取并编码为标准的灰度图 PNG (Color Type 0)
 * 背景完全透明(alpha=0)对应纯黑 (0)，完全不透明(alpha=255)对应纯白 (255)
 */
export function encodeGrayscalePng(width, height, alpha) {
  const rawStride = width + 1;
  const rawBytes = Buffer.alloc(rawStride * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rawStride;
    rawBytes[rowOffset] = 0; // Filter: None
    rawBytes.set(alpha.subarray(y * width, (y + 1) * width), rowOffset + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8-bit depth
  header[9] = 0; // Color type: 0 (Grayscale)
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rawBytes)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Decode the validated non-interlaced 8-bit PNG; inspection never changes original bytes. */
export function decodePng(bytes) {
  const dimensions=validatePng(bytes),{width,height}=dimensions,color=bytes[25],channels={0:1,2:3,4:2,6:4}[color],parts=[];
  for(let o=8;o<bytes.length;){const n=bytes.readUInt32BE(o);if(bytes.toString('ascii',o+4,o+8)==='IDAT')parts.push(bytes.subarray(o+8,o+8+n));o+=n+12;}
  const stride=width*channels,raw=inflateSync(Buffer.concat(parts),{maxOutputLength:(stride+1)*height}),decoded=new Uint8Array(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
  for(let y=0;y<height;y++)for(let x=0;x<stride;x++){
    const a=x>=channels?decoded[y*stride+x-channels]:0,b=y?decoded[(y-1)*stride+x]:0,c=y&&x>=channels?decoded[(y-1)*stride+x-channels]:0,f=raw[y*(stride+1)];
    decoded[y*stride+x]=(raw[y*(stride+1)+1+x]+(f===1?a:f===2?b:f===3?Math.floor((a+b)/2):f===4?paeth(a,b,c):0))&255;
  }
  const alpha=new Uint8Array(width*height),rgb=new Uint8Array(width*height*3);
  for(let i=0;i<alpha.length;i++){const o=i*channels;alpha[i]=color===6?decoded[o+3]:color===4?decoded[o+1]:255;for(let c=0;c<3;c++)rgb[i*3+c]=color===0||color===4?decoded[o]:decoded[o+c];}
  return {...dimensions,alpha,rgb,hasAlpha:color===4||color===6};
}
export function alphaQuality(image) {
  const {alpha,width,height,hasAlpha}=image,area=alpha.length;let transparent=0,near=0,foreground=0,opaque=0,borderMax=0;
  for(let i=0;i<area;i++){const a=alpha[i];transparent+=a===0;near+=a<=4;foreground+=a>=32;opaque+=a>=251;const x=i%width,y=Math.floor(i/width);if(x===0||x===width-1||y===0||y===height-1)borderMax=Math.max(borderMax,a);}
  const warnings=[];if(!hasAlpha||near/area<.05||opaque/area<.02||foreground/area<.05||foreground/area>.92)warnings.push('invalid_or_implausible_alpha');
  if(borderMax>4)warnings.push('foreground_touches_canvas_edge');
  return {ready:warnings.length===0,warnings,transparentPixels:transparent,totalPixels:area,nearTransparentPixels:near,foregroundPixels:foreground,borderMaxAlpha:borderMax,threshold:4};
}
/** Conservative preservation guard, not semantic segmentation. Its mask is never used as output. */
export function preservationQuality(original,cutout) {
  if(original.width!==cutout.width||original.height!==cutout.height)return {ready:false,warnings:['dimensions_changed']};
  const {width:w,height:h,rgb}=original,n=w*h,background=new Uint8Array(n),seen=new Uint8Array(n),queue=new Int32Array(n);let start=0,end=0,edgeCount=0,edgeWhite=0;
  for(let i=0;i<n;i++){const r=rgb[i*3],g=rgb[i*3+1],b=rgb[i*3+2];background[i]=Math.max(255-r,255-g,255-b)<=28?1:0;const x=i%w,y=Math.floor(i/w);if(x===0||x===w-1||y===0||y===h-1){edgeCount++;edgeWhite+=background[i];if(background[i]){seen[i]=1;queue[end++]=i;}}}
  if(edgeWhite/edgeCount<.95)return {ready:false,warnings:['source_background_not_uniform_white']};
  while(start<end){const i=queue[start++],x=i%w;for(const j of [x?i-1:-1,x<w-1?i+1:-1,i-w,i+w])if(j>=0&&j<n&&!seen[j]&&background[j]){seen[j]=1;queue[end++]=j;}}
  let total=0,kept=0,bottomTotal=0,bottomKept=0,maxY=0,minY=h;
  for(let i=0;i<n;i++)if(!seen[i]){const y=Math.floor(i/w);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  const bottom=minY+(maxY-minY)*.65;
  for(let i=0;i<n;i++)if(!seen[i]){total++;kept+=cutout.alpha[i]>=32;if(Math.floor(i/w)>=bottom){bottomTotal++;bottomKept+=cutout.alpha[i]>=32;}}
  const coverage=total?kept/total:0,baseCoverage=bottomTotal?bottomKept/bottomTotal:0,warnings=[];
  if(coverage<.90)warnings.push('possible_scene_content_removed');if(baseCoverage<.94)warnings.push('possible_terrain_base_removed');
  return {ready:warnings.length===0,warnings,foregroundRetention:coverage,lowerRegionRetention:baseCoverage};
}
