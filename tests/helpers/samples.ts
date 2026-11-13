import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfText, type PdfLib } from '../../lib/pdf/extract.ts';
import { makePdf } from './make-pdf.ts';

/** pdf.js legacy build, usable in Node without a worker. */
export const pdfjs = pdfjsLib as unknown as PdfLib;

/**
 * Synthetic sample documents from three academic subjects.
 * Written for the tests; they are not taken from any real course material.
 */
export const SAMPLES = {
  biology: {
    name: 'biology-photosynthesis.pdf',
    pages: [
      'Photosynthesis is the process plants use to convert light energy into chemical energy. It takes place inside organelles called chloroplasts, which are found mainly in leaf cells. Chlorophyll is the green pigment that absorbs light, mostly from the blue and red parts of the spectrum. The overall reaction combines carbon dioxide and water to produce glucose and oxygen. Oxygen is released into the atmosphere through small openings called stomata. Without photosynthesis, most food chains on Earth would have no source of energy.',
      'The light-dependent reactions happen in the thylakoid membranes of the chloroplast. Light energy splits water molecules, which releases oxygen as a by-product. These reactions produce two energy carriers named ATP and NADPH. The Calvin cycle then uses ATP and NADPH to build glucose from carbon dioxide. The Calvin cycle takes place in the stroma, the fluid that surrounds the thylakoids. Because it does not need light directly, the Calvin cycle is sometimes called the light-independent stage.',
      'Several factors limit the rate of photosynthesis in a living plant. Light intensity increases the rate only until another factor becomes limiting. Carbon dioxide concentration is often the limiting factor on a bright summer day. Temperature matters because the enzymes of the Calvin cycle work best within a narrow range. Farmers use greenhouses to control temperature, light and carbon dioxide at the same time. Comparing these factors explains why crops grow faster in some conditions than in others.',
    ],
  },
  history: {
    name: 'history-printing-press.pdf',
    pages: [
      'Johannes Gutenberg developed a printing press with movable metal type in Mainz around 1450. Before this invention, books in Europe were copied by hand, usually by monks working in monasteries. A single handwritten Bible could take a scribe more than a year to complete. Movable type allowed a printer to arrange individual letters and reuse them for many pages. The Gutenberg Bible, finished around 1455, was the first major book printed with this method in Europe. Printing made each copy of a book far cheaper than a handwritten manuscript.',
      'Printing spread quickly along the trade routes of the Rhine river and into Italy. By 1500, printing shops operated in more than two hundred European towns. Historians estimate that millions of printed books existed by the end of the fifteenth century. Cheaper books encouraged more people to learn to read in their own languages. Printers began publishing works in German, French and English instead of only Latin. Standard spellings slowly emerged because thousands of readers saw the same printed text.',
      'The printing press changed how ideas moved through European society. Martin Luther used printed pamphlets to spread his criticisms of the church after 1517. Rulers and church leaders answered with their own printed arguments and with censorship laws. Scientists could now share identical diagrams and tables with colleagues in distant cities. Some historians argue that the scientific revolution depended on this reliable exchange of printed knowledge. Others point out that literacy remained limited, so the effects reached ordinary villagers only slowly.',
    ],
  },
  computing: {
    name: 'computing-operating-systems.pdf',
    pages: [
      'An operating system is the software that manages the hardware of a computer for other programs. The central part of an operating system is called the kernel. A process is a program that is currently running, together with its memory and resources. The kernel gives each process a unique number called a process identifier. Programs request services from the kernel through an interface known as system calls. Typical services include reading files, creating processes and sending data over a network.',
      'The scheduler is the kernel component that decides which process runs next on the processor. In round-robin scheduling, every process receives a short time slice in turn. A context switch saves the state of one process and restores the state of another. Frequent context switches make a system feel responsive but add measurable overhead. Priority scheduling lets important processes run before less important ones. A badly chosen priority scheme can cause starvation, where a waiting process never gets to run.',
      'Virtual memory lets each process behave as if it had its own private address space. The kernel divides memory into fixed-size blocks called pages. A page table records where each virtual page is stored in physical memory. When a process touches a page that is not in memory, the processor raises a page fault. The kernel handles the page fault by loading the missing page from disk. Heavy paging activity, known as thrashing, can slow a system far more than a shortage of processor time.',
    ],
  },
} as const;

export type SampleKey = keyof typeof SAMPLES;
export const SAMPLE_KEYS = Object.keys(SAMPLES) as SampleKey[];

export const samplePdfBytes = (key: SampleKey) => makePdf([...SAMPLES[key].pages]);

export const extractSample = (key: SampleKey) => extractPdfText(pdfjs, samplePdfBytes(key), SAMPLES[key].name);
