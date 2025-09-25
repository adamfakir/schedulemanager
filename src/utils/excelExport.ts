import { saveAs } from 'file-saver';
import ExcelJS from 'exceljs';

interface TimeBlock {
  start: { day: string; time: string };
  end: { day: string; time: string };
  color: string;
  name: string;
  displayclass?: string;
  teachers?: string[];
  subjectId: string;
}

interface ScheduleItem {
  type: string;
  name: string;
  displayname?: string;
}

// Helper function to convert time to minutes for calculations
const timeToMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

// Helper function to convert minutes back to time string
const minutesToTime = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
};

// Convert hex color to RGB values
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 226, g: 232, b: 240 }; // Default light gray
};

// Crop semester tags from names
const cropSemesterTag = (name: string): string =>
  name.replace(/\[SEM1\]|\[SEM2\]/gi, '').trim();

export const exportScheduleToExcel = async (
  timeblocks: TimeBlock[],
  item: ScheduleItem,
  sortedTimes: string[],
  hideTeacherNames: boolean = false,
  showEndTime: boolean = false
): Promise<void> => {
  console.log('📦 ExcelJS export function called');
  console.log('📊 Item:', item?.type, item?.displayname || item?.name);
  console.log('📅 Timeblocks count:', timeblocks?.length);
  console.log('⏰ Sorted times count:', sortedTimes?.length);
  
  // Validate inputs
  if (!timeblocks || !Array.isArray(timeblocks)) {
    throw new Error('Invalid timeblocks data provided');
  }
  
  if (!item || typeof item !== 'object') {
    throw new Error('Invalid item data provided');
  }
  
  if (!sortedTimes || !Array.isArray(sortedTimes) || sortedTimes.length === 0) {
    throw new Error('Invalid sortedTimes data provided');
  }
  
  console.log('✅ Input validation passed');
  
  try {
    console.log('📝 Creating new ExcelJS workbook...');
    const workbook = new ExcelJS.Workbook();
    
    // Sanitize sheet name by removing invalid characters
    const rawSheetName = `${item.type} - ${item.displayname || item.name}`;
    const sheetName = rawSheetName.replace(/[:\\/?*[\]]/g, '').trim();
    console.log('📝 Sheet name sanitized:', rawSheetName, '→', sheetName);
    
    const worksheet = workbook.addWorksheet(sheetName);
    
    console.log('🏗️ Setting up grid structure...');
    const dayColumns = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    
    // Set up header row
    console.log('🏷️ Setting up headers...');
    const headers = showEndTime ? ['Start Time', 'End Time', ...dayColumns] : ['Time', ...dayColumns];
    const headerRow = worksheet.addRow(headers);
    headerRow.height = 25; // Smaller header height
    
    // Style header row
    headerRow.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF3B82F6' } // Blue background
      };
      cell.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' }, // White text
        size: 10,
        name: 'Calibri'
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF1E40AF' } },
        bottom: { style: 'medium', color: { argb: 'FF1E40AF' } },
        left: { style: 'medium', color: { argb: 'FF1E40AF' } },
        right: { style: 'medium', color: { argb: 'FF1E40AF' } }
      };
    });
    
    console.log('📏 Calculating dynamic row heights and adding time rows...');
    // Add time rows with dynamic heights
    sortedTimes.forEach((time, index) => {
      const nextTime = sortedTimes[index + 1];
      const endTimeValue = nextTime || "—";
      const rowData = showEndTime ? [time, endTimeValue, '', '', '', '', ''] : [time, '', '', '', '', ''];
      const row = worksheet.addRow(rowData);
      
      // Calculate row height based on duration to next time
      let rowHeight = 30; // Default height
      
      if (nextTime) {
        const currentMin = timeToMinutes(time);
        const nextMin = timeToMinutes(nextTime);
        const durationMinutes = nextMin - currentMin;
        // Much smaller scale: 15 pixels base + 0.5 pixel per minute (minimum 15, maximum 45)
        rowHeight = Math.max(15, Math.min(45, 15 + durationMinutes * 0.5));
        console.log(`⏰ Row ${index + 2} (${time}): ${durationMinutes}min → ${rowHeight}px`);
      } else {
        rowHeight = 20; // Smaller default height
      }
      
      row.height = rowHeight;
      
      // Style time column(s)
      const timeCell = row.getCell(1);
      timeCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF3B82F6' } // Blue background
      };
      timeCell.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' }, // White text
        size: 9,
        name: 'Calibri'
      };
      timeCell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };
      timeCell.border = {
        top: { style: 'thin', color: { argb: 'FF1E40AF' } },
        bottom: { style: 'thin', color: { argb: 'FF1E40AF' } },
        left: { style: 'medium', color: { argb: 'FF1E40AF' } },
        right: { style: 'medium', color: { argb: 'FF1E40AF' } }
      };
      
      // Style end time column if showing end times
      if (showEndTime) {
        const endTimeCell = row.getCell(2);
        endTimeCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF3B82F6' } // Blue background
        };
        endTimeCell.font = {
          bold: true,
          color: { argb: 'FFFFFFFF' }, // White text
          size: 9,
          name: 'Calibri'
        };
        endTimeCell.alignment = {
          horizontal: 'center',
          vertical: 'middle'
        };
        endTimeCell.border = {
          top: { style: 'thin', color: { argb: 'FF1E40AF' } },
          bottom: { style: 'thin', color: { argb: 'FF1E40AF' } },
          left: { style: 'medium', color: { argb: 'FF1E40AF' } },
          right: { style: 'medium', color: { argb: 'FF1E40AF' } }
        };
      }
      
      // Style empty cells with borders
      const startCol = showEndTime ? 3 : 2; // Skip both time columns if showing end time
      const totalCols = showEndTime ? dayColumns.length + 2 : dayColumns.length + 1;
      for (let col = startCol; col <= totalCols; col++) {
        const cell = row.getCell(col);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' } // White background
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
        };
        cell.alignment = {
          horizontal: 'center',
          vertical: 'middle'
        };
      }
    });
    
    console.log('📅 Processing and styling schedule blocks...');
    // Process timeblocks and add them to the worksheet
    const dayToColumn: { [key: string]: number } = showEndTime ? {
      Monday: 3,
      Tuesday: 4,
      Wednesday: 5,
      Thursday: 6,
      Friday: 7
    } : {
      Monday: 2,
      Tuesday: 3,
      Wednesday: 4,
      Thursday: 5,
      Friday: 6
    };
    
    timeblocks.forEach((block, blockIndex) => {
      console.log(`📦 Processing block ${blockIndex + 1}/${timeblocks.length}:`, {
        name: block.name,
        day: block.start.day,
        time: `${block.start.time} - ${block.end.time}`,
        color: block.color
      });
      
      const startRowIndex = sortedTimes.indexOf(block.start.time) + 2; // +2 for header and 1-based indexing
      const endRowIndex = sortedTimes.indexOf(block.end.time) + 2;
      const colIndex = dayToColumn[block.start.day];
      
      if (startRowIndex > 1 && colIndex) {
        // Handle color first
        let bgColor = 'E2E8F0'; // Default light gray
        let textColor = '000000'; // Default black text
        
        if (block.color) {
          const colorWithoutHash = block.color.replace('#', '').toUpperCase();
          
          // Handle both 3-char and 6-char hex colors
          if (/^[0-9A-F]{3}$/i.test(colorWithoutHash)) {
            bgColor = colorWithoutHash.split('').map(c => c + c).join('');
          } else if (/^[0-9A-F]{6}$/i.test(colorWithoutHash)) {
            bgColor = colorWithoutHash;
          }
          
          // Calculate text color based on background brightness
          const r = parseInt(bgColor.substring(0, 2), 16);
          const g = parseInt(bgColor.substring(2, 4), 16);
          const b = parseInt(bgColor.substring(4, 6), 16);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          textColor = brightness > 128 ? '000000' : 'FFFFFF';
          
          console.log(`🎨 Block "${block.name}": bg=#${bgColor}, text=#${textColor}, brightness=${Math.round(brightness)}`);
        }
        
        // Create cell content with rich text formatting (after color calculation)
        const subjectName = cropSemesterTag(block.name);
        let cellContent: any = {
          richText: [
            {
              text: subjectName,
              font: { bold: true, color: { argb: `FF${textColor}` }, size: 9, name: 'Calibri' }
            }
          ]
        };
        
        // Add additional text that should not be bold
        if (item.type === "Teacher" && block.displayclass) {
          cellContent.richText.push({
            text: `\n${cropSemesterTag(block.displayclass)}`,
            font: { bold: false, color: { argb: `FF${textColor}` }, size: 8, name: 'Calibri' }
          });
        }
        if (item.type === "Student" && block.teachers && block.teachers.length > 0 && !hideTeacherNames) {
          const teacherText = block.teachers.map(t => cropSemesterTag(t)).join(", ");
          cellContent.richText.push({
            text: `\n${teacherText}`,
            font: { bold: false, color: { argb: `FF${textColor}` }, size: 8, name: 'Calibri' }
          });
        }
        
        // Set cell value and style
        const cell = worksheet.getCell(startRowIndex, colIndex);
        cell.value = cellContent;
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${bgColor}` }
        };
        cell.alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: true
        };
        cell.border = {
          top: { style: 'medium', color: { argb: 'FF000000' } },
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
          left: { style: 'medium', color: { argb: 'FF000000' } },
          right: { style: 'medium', color: { argb: 'FF000000' } }
        };
        
        // Merge cells if block spans multiple time slots
        if (endRowIndex > startRowIndex + 1) {
          try {
            worksheet.mergeCells(startRowIndex, colIndex, endRowIndex - 1, colIndex);
            console.log(`🔗 Merged cells from row ${startRowIndex} to ${endRowIndex - 1} in column ${colIndex}`);
          } catch (error) {
            console.warn(`⚠️ Failed to merge cells for block "${block.name}":`, error);
          }
        }
        
        console.log(`✅ Styled cell at row ${startRowIndex}, col ${colIndex}`);
      }
    });
    
    console.log('📐 Setting column widths...');
    // Set more compact column widths
    worksheet.getColumn(1).width = 8; // Start time column (smaller)
    if (showEndTime) {
      worksheet.getColumn(2).width = 8; // End time column (smaller)
    }
    const dayStartCol = showEndTime ? 3 : 2;
    const totalCols = showEndTime ? dayColumns.length + 2 : dayColumns.length + 1;
    for (let i = dayStartCol; i <= totalCols; i++) {
      worksheet.getColumn(i).width = 18; // Day columns (smaller)
    }
    
    console.log('🔲 Adding borders to ALL cells...');
    // Add borders to every single cell in the used range
    const totalRows = sortedTimes.length + 1; // +1 for header
    const finalTotalCols = showEndTime ? dayColumns.length + 2 : dayColumns.length + 1; // +1 or +2 for time columns
    
    for (let row = 1; row <= totalRows; row++) {
      for (let col = 1; col <= finalTotalCols; col++) {
        const cell = worksheet.getCell(row, col);
        
        // Ensure every cell has a value (even if empty) so borders show
        if (!cell.value) {
          cell.value = '';
        }
        
        // Apply borders to every cell regardless of existing styling
        const existingBorder = cell.border || {};
        cell.border = {
          top: existingBorder.top || { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: existingBorder.bottom || { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: existingBorder.left || { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: existingBorder.right || { style: 'thin', color: { argb: 'FFD1D5DB' } }
        };
        
        // Ensure empty cells have proper styling
        if (!cell.fill) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' } // White background
          };
        }
        
        // Ensure proper alignment for empty cells
        if (!cell.alignment) {
          cell.alignment = {
            horizontal: 'center',
            vertical: 'middle'
          };
        }
      }
    }
    console.log(`✅ Borders and styling applied to all ${totalRows}x${finalTotalCols} cells`);
    
    console.log('💾 Generating Excel file...');
    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    
    // Generate filename
    const sanitizedName = (item.displayname || item.name).replace(/[^a-zA-Z0-9\-_\s]/g, '').trim().replace(/\s+/g, '_');
    const fileName = `Schedule_${item.type}_${sanitizedName}.xlsx`;
    
    console.log('📁 Triggering download for:', fileName);
    console.log('📊 Excel buffer size:', buffer.byteLength, 'bytes');
    
    saveAs(blob, fileName);
    console.log('✅ ExcelJS export completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during ExcelJS generation:', error);
    throw new Error(`Excel generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};