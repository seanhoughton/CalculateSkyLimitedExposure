#include <pjsr/Sizer.jsh>
#include <pjsr/FrameStyle.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/NumericControl.jsh>

#feature-id    Utilities > CalculateSkyLimitedExposure

#feature-info  Calculates the sky-limited exposure time for a given camera/telescope combination \
               using a test image containing significant background pixels.

#feature-icon  CalculateSkyLimitedExposure.xpm

#define TITLE CalculateSkyLimitedExposure
#define VERSION 2.1

// Sources:
// Canon camera stats:   http://www.astrosurf.com/buil/50d/test.htm
// Astro camera stats:   http://starizona.com/acb/ccd/advtheoryexp.aspx
// Alternaitve exposure: http://www.cloudynights.com/item.php?item_id=1622

function debugPrint(text)
{
   //console.writeln(text);
}

function delquote(str)
{
   return (str=str.replace(/["']{1}/gi,""));
}

function chopPrecision(value, significantDigits)
{
   var dec = Math.pow(10, significantDigits);
   return Math.round(value*dec)/dec;
}

function humanReadableTime(timeInSeconds)
{
   var minutes = Math.floor(timeInSeconds/60.0);
   var seconds = Math.round(timeInSeconds - (minutes*60.0));
   return minutes.toString() + "m " + seconds.toString() + "s";
}

function htmlFraction(num, denom)
{
   return "<sup>" + num + "</sup>&frasl;<sub>" + denom + "</sub>";
}

function getKeywordFloatValue(keywords, keyword, defaultValue)
{
   for(var k=0; k < keywords.length; ++k)
   {
      if(keywords[k].name == keyword)
         return parseFloat(keywords[k].value);
   }
   return defaultValue;
}

function CCD(name, gain, readnoise, darkCurrentNoise, bitsPerChannel)
{
	this.name = name;
	this.gain = gain;
	this.readnoise = readnoise;
   this.bitsPerChannel = bitsPerChannel;
   this.darkCurrentNoise = darkCurrentNoise;

   this.getMaxCount = function()
   {
      return Math.pow(2, this.bitsPerChannel)-1;
   }

   this.normToAdu = function(normalizedValue)
   {
      return normalizedValue * this.getMaxCount();
   }

   this.aduToE = function(adu)
   {
      return adu * this.gain;
   }

   this.eToAdu = function(e)
   {
      return e / this.gain;
   }

   this.totalNoiseE = function(t)
   {
      // ignore read noise term, we're assuming that this is low enough so as not to matter
      // relative to the sky noise and dark currrent noise
      // Ncamera = ( Ndc^2 + Nro^2 )^0.5
      //return Math.sqrt(Math.pow(this.darkCurrentNoise,2) * t + Math.pow(this.readnoise,2));
      return this.darkCurrentNoise * t;
   }
}

function ImageData()
{
   this.pedestal = 0;
   this.exposure = 0;
   this.binning = 1;
   this.image = null;
   this.median = 0;

   this.isValid = function()
   {
      if(this.image == null)
         return false;

      if(this.exposure == 0)
         return false;

      if(this.median == 0)
         return false;

      return true;
   }

   this.loadValues = function(view)
   {
      var keywords = view.window.keywords;
      this.pedestal = getKeywordFloatValue(keywords, "PEDESTAL", 0);
      this.exposure = getKeywordFloatValue(keywords, "EXPOSURE", 0);
      this.binning = getKeywordFloatValue(keywords, "XBINNING", 1);
      this.median = this.getMedian();
   }

   this.setView = function(view)
   {
      this.image = view.image;
      this.loadValues(view);
   }

   this.getMedian = function()
   {
      var statistics = new ImageStatistics();
      with(statistics)
      {
         medianEnabled = true;
      }
      statistics.generate(this.image);
      return statistics.median;
   }

   this.getFluxE = function(ccd)
   {
      if(this.image == null)
         return 0;

      var med = this.median;
      return this.convertToE(med, ccd);
   }

   this.convertToE = function(normalizedValue, ccd)
   {
      var adu = ccd.normToAdu(normalizedValue) - this.pedestal;
      return ccd.aduToE(adu);
   }
}

function CalculateOptimalExposureEngine()
{

   this.totalExposure = 3600;
   this.backgroundFluxE = 0;

   // RO noise model limit model
   //
   this.readoutNoisePct = 5; // in decimal [0,100]
   this.skyLimitedExposure = 0;
   this.skyLimitedExposure2 = 0;

   // Quantization limit model
   //
   this.minimumTargetAdu = 15;
   this.ansteyLimitedExposure = 0;


   this.ccd = new CCD('', 0, 0, 0, 0);
   this.backgroundImageData = new ImageData();

   this.isValid = function()
   {
      if(!this.backgroundImageData.isValid())
         return false;

      return true;
   }

   this.generate = function()
   {
      var backgroundE = this.backgroundImageData.getFluxE(this.ccd);
      this.backgroundFluxE = backgroundE / (this.backgroundImageData.exposure);

      this.skyLimitedExposure = this.calculateSkyLimitedExposure();
      this.skyLimitedExposure2 = this.calculateSkyLimitedExposure2();

      this.ansteyLimitedExposure = this.calculateAnsteyLimitedExposure();
   }

   this.limitedExposureString = function()
   {
      return humanReadableTime(this.skyLimitedExposure) + " (" + Math.round(this.skyLimitedExposure) + "s)";
   }

   this.limitedExposure2String = function()
   {
      return humanReadableTime(this.skyLimitedExposure2) + " (" + Math.round(this.skyLimitedExposure2) + "s)";
   }


   this.ansteyLimitedExposureString = function()
   {
      return humanReadableTime(this.ansteyLimitedExposure) + " (" + Math.round(this.ansteyLimitedExposure) + "s)";
   }

   this.fluxString = function(flux)
   {
      var fluxInAdu = chopPrecision(flux * this.ccd.gain, 2);
      var fluxInE = chopPrecision(flux, 2);
      return fluxInE.toString() + " " + htmlFraction("e-", "s") + "    (" + fluxInAdu.toString() + " " + htmlFraction("ADU","s") + ")";
   }

   this.backgroundFluxString = function()
   {
      return this.fluxString(this.backgroundFluxE);
   }

   this.targetFluxString = function()
   {
      return this.fluxString(this.targetFluxE);
   }

   // from http://starizona.com/acb/ccd/advtheoryexp.aspx
   this.calculateSkyLimitedExposure = function()
   {
      debugPrint("");
      debugPrint("-------------------------------------------");
      debugPrint("Read noise limited exposure calculation (I)");
      debugPrint("-------------------------------------------");
      debugPrint("Background ADU: " + this.ccd.normToAdu(this.backgroundImageData.median) + " ADU");
      debugPrint("Background Flux:" + this.backgroundFluxE + " e-");
      debugPrint("RO Noise:       " + this.ccd.readnoise + " e-");
      debugPrint("");

      debugPrint("t = (Ron*Ron) / (((1+p)^2-1) * Esky)");
      var pct = this.readoutNoisePct / 100.0;
      var effectiveReadoutNoiseE = this.ccd.readnoise / this.backgroundImageData.binning;

      debugPrint("t = " + effectiveReadoutNoiseE + "^2 / " + "(((1+" + pct + ")^2-1) * " + this.backgroundFluxE + ")");

      var k = 1.0 / (((1.0+pct)*(1.0+pct)) - 1.0);
      var result = k * Math.pow(effectiveReadoutNoiseE,2) / this.backgroundFluxE;

      debugPrint("t = " + result);
      debugPrint("");

      return result;
   }

   // from http://starizona.com/acb/ccd/advtheoryexp.aspx
   this.calculateSkyLimitedExposure2 = function()
   {
      debugPrint("");
      debugPrint("--------------------------------------------");
      debugPrint("Read noise limited exposure calculation (II)");
      debugPrint("--------------------------------------------");
      debugPrint("Background ADU: " + this.ccd.normToAdu(this.backgroundImageData.median) + " ADU");
      debugPrint("Background Flux:" + this.backgroundFluxE + " e-");
      debugPrint("RO Noise:       " + this.ccd.readnoise + " e-");
      debugPrint("");

      debugPrint("t = (4.38 * Ron^2) / (Elp^2 + Edc^2)");

      var pct = this.readoutNoisePct / 100.0;
      var effectiveReadoutNoiseE = this.ccd.readnoise / this.backgroundImageData.binning;

      debugPrint("t = (4.38 * " + effectiveReadoutNoiseE + "^2) / ("+ this.backgroundFluxE + "^2 + " + this.ccd.darkCurrentNoise + "^2)");

      var result = 4.38 * Math.pow(effectiveReadoutNoiseE,2) / (Math.pow(this.backgroundFluxE,2)+Math.pow(this.ccd.darkCurrentNoise,2));

      debugPrint("t = " + result);
      debugPrint("");

      return result;
   }

   // http://www.cloudynights.com/item.php?item_id=1622
   this.calculateAnsteyLimitedExposure = function()
   {
      debugPrint("");
      debugPrint("-----------------------------------");
      debugPrint("Anstey limited exposure calculation");
      debugPrint("-----------------------------------");

      //this.backgroundFluxE = (16.5/60.0) * this.ccd.gain;

      // LP noise = LPsignal^0.5
      var lpNoiseE = Math.sqrt(this.backgroundFluxE);
      debugPrint("LP Noise:     " + chopPrecision(lpNoiseE,3) + " e-/s  (" + chopPrecision(60 * this.ccd.eToAdu(lpNoiseE),3) + " ADU/m)");

      var readoutNoiseE = this.ccd.readnoise;
      debugPrint("Readout Noise:" + chopPrecision(this.ccd.readnoise,3) + " e-  (" + chopPrecision(60 * this.ccd.eToAdu(this.ccd.readnoise),3) + " ADU)");

      var minimumTargetE = this.ccd.aduToE(this.minimumTargetAdu);
      debugPrint("Lamda:       " + minimumTargetE + " e-   (" + this.minimumTargetAdu + " ADU)");

      // equation (16) from the Anstey paper
      var a = Math.pow(readoutNoiseE,4) + Math.pow(minimumTargetE,2) * Math.pow(this.backgroundFluxE,2) * this.totalExposure;
      var result = (-Math.pow(readoutNoiseE,2) + Math.pow(a, 0.5)) / (2 * Math.pow(this.backgroundFluxE,2));
      debugPrint("Exposure:    " + chopPrecision(result,1) + " s");
      debugPrint("");

      return result;
   }

   this.drawChart = function(ctrl)
   {
      var pixelsPerE = 1.0;
      var pixelsPerSec = 10;

      var G = new Graphics( ctrl );
      G.pen = new Pen( 0xFF00FF00 ); //Green
      for(var x=0; x < 200-1; ++x)
      {
         var ta = x * pixelsPerSec;
         var tb = (x+1) * pixelsPerSec;

         var skyNoiseYa = this.ccd.totalNoiseE(ta) * pixelsPerE;
         var skyNoiseYb = this.ccd.totalNoiseE(tb) * pixelsPerE;
         G.drawLine(new Point(x,skyNoiseYa), new Point(x+1,skyNoiseYb));


//         G.drawLine(new Point(x,0), new Point(x,10));
      }
      G.end();
      gc();
   }
}

var engine = new CalculateOptimalExposureEngine;


var cameraPresets = new Array(
   new CCD('Custom', 0, 0, 0, 16),
   new CCD('Apogee Alta U16M', 1.5, 10, 0, 16),
	new CCD('Apogee AP1E', 3, 15, 0, 16),
	new CCD('Apogee AP2E', 3, 15, 0, 16),
	new CCD('Apogee AP32ME', 3, 10, 0, 16),
	new CCD('Apogee AP260E', 3, 15, 0, 16),
	new CCD('Apogee AP4', 3, 15, 0, 16),
	new CCD('Apogee AP6E', 3, 15, 0, 16),
	new CCD('Apogee AP7', 3, 12, 0, 16),
	new CCD('Apogee AP8', 3, 12, 0, 16),
	new CCD('Apogee AP9E', 3, 15, 0, 16),
	new CCD('Apogee AP10', 3, 15, 0, 16),
	new CCD('Apogee AP16', 3, 15, 0, 16),
	new CCD('Apogee AP47', 3, 7, 0, 16),

   new CCD('Canon 350D @ ISO 400', 2.67, 8.0, 0, 12),
   new CCD('Canon 350D @ ISO 800', 1.33, 8.0, 0, 12),
   new CCD('Canon 400D @ ISO 400', 2.74, 7.0, 0, 12),
   new CCD('Canon 400D @ ISO 800', 1.37, 7.0, 0, 12),
   new CCD('Canon 10D @ ISO 400', 2.41, 14.9, 0, 12),
   new CCD('Canon 10D @ ISO 800', 1.20, 14.9, 0, 12),
   new CCD('Canon 20D @ ISO 400', 3.14, 7.5, 0, 12),
   new CCD('Canon 20D @ ISO 800', 1.57, 7.5, 0, 12),
   new CCD('Canon 40D @ ISO 400', 0.84, 6.8, 0, 14),
   new CCD('Canon 40D @ ISO 800', 0.42, 5.3, 0, 14),
   new CCD('Canon 50D @ ISO 400', 0.57, 4.9, 0, 14),
   new CCD('Canon 50D @ ISO 800', 0.29, 3.4, 0, 14),
   new CCD('Canon 5D @ ISO 400', 3.99, 8.2, 0, 12),
   new CCD('Canon 5D @ ISO 800', 1.99, 5.1, 0, 12),
   new CCD('Canon 5DMkII @ ISO 400', 1.01, 7.3, 0, 14),
   new CCD('Canon 5DMkII @ ISO 800', 0.50, 4.2, 0, 14),

	new CCD('FLI IMG512S', 3, 7, 0, 16),
	new CCD('FLI IMG1024S', 3, 7, 0, 16),
	new CCD('FLI IMG261E', 3, 15, 0, 16),
	new CCD('FLI IMG401E', 1.5, 15, 0, 16),
	new CCD('FLI IMG1001E', 3, 15, 0, 16),
	new CCD('FLI IMG1302E', 3, 15, 0, 16),
	new CCD('FLI IMG1401E', 3, 15, 0, 16),
	new CCD('FLI IMG1602E', 3, 15, 0, 16),
	new CCD('FLI IMG3200E', 3, 10, 0, 16),
	new CCD('FLI IMG4202', 3, 15, 0, 16),
	new CCD('FLI IMG4300E', 3, 15, 0, 16),
	new CCD('FLI IMG6303E', 3, 15, 0, 16),
	new CCD('FLI IMG16801E', 3, 15, 0, 16),
	new CCD('FLI IMG42-40', 2, 7, 0, 16),
	new CCD('FLI MaxCam CM1-1', 3, 7, 0, 16),
	new CCD('FLI MaxCam CM2-2', 2, 7, 0, 16),
	new CCD('FLI MaxCam CM7E', 1.5, 15, 0, 16),
	new CCD('FLI MaxCam CM8E', 1.5, 15, 0, 16),
	new CCD('FLI MaxCam CM9E', 3, 15, 0, 16),
	new CCD('FLI MaxCam CM10E/ME', 3, 10, 0, 16),
   new CCD('FLI M8300', 0.4, 7.59, 0, 16),

	new CCD('QHY8', 3, 10, 0, 16),
	new CCD('QHY8PRO', 3, 10, 0, 16),
	new CCD('QHY9', 0.5, 10, 0, 16),
	new CCD('QSI 504', 2.6, 15, 0, 16),
   new CCD('QSI 516', 2.6, 15, 0, 16),
   new CCD('QSI 532', 1.3, 7, 0, 16),
   new CCD('QSI 520', 0.8, 8, 0, 16),
   new CCD('QSI 540', 0.8, 8, 0, 16),
   new CCD('QSI 583', 0.5, 8, 0, 16),

	new CCD('SBIG ST-237A', 2.3, 17, 0, 16),
	new CCD('SBIG ST-7XE/XME', 2.6, 15, 0, 16),
	new CCD('SBIG ST-8XE/XME', 2.5, 15, 0, 16),
	new CCD('SBIG ST-9XE', 2.2, 15, 0, 16),
	new CCD('SBIG ST-10XE/XME', 1.3, 7, 0, 16),
	new CCD('SBIG ST-2000XM/XCM', 0.6, 7.6, 0, 16),
	new CCD('SBIG ST-4000XCM', 0.6, 7.9, 0, 16),
	new CCD('SBIG ST-1001E', 2, 15, 0, 16),
	new CCD('SBIG STL-4020M/CM', 0.6, 7.8, 0, 16),
	new CCD('SBIG STL-1301E/LE', 1.6, 18, 0, 16),
	new CCD('SBIG STL-1001E', 2, 15, 0, 16),
	new CCD('SBIG STL-11000M/CM', 0.8, 13, 0, 16),
	new CCD('SBIG STL-6303E/LE', 2.4, 13, 0, 16),
	new CCD('SBIG ST-402ME', 2.6, 15, 0, 16),
	new CCD('SBIG ST-8300', 0.37, 9.3, 0, 16),

	new CCD('Starlight Xpress HX516', 1, 11, 0, 16),
	new CCD('Starlight Xpress HX916', 2, 12, 0, 16),
	new CCD('Starlight Xpress MX516', 1, 11, 0, 16),
	new CCD('Starlight Xpress MX716', 1.3, 10, 0, 16),
	new CCD('Starlight Xpress MX916', 2, 11, 0, 16),
	new CCD('Starlight Xpress MX5C', 1, 11, 0, 16),
	new CCD('Starlight Xpress MX7C', 1.3, 10, 0, 16),
	new CCD('Starlight Xpress SXVF-H9/H9C', 0.45, 7, 0, 16),
	new CCD('Starlight Xpress SXVF-M5/M5C', 1, 11, 0, 16),
	new CCD('Starlight Xpress SXVF-M7/M7C', 1.3, 10, 0, 16),
	new CCD('Starlight Xpress SXVF-M8C', 0.2, 7, 0, 16),
	new CCD('Starlight Xpress SXVF-M9', 2, 12, 0, 16),
	new CCD('Starlight Xpress SXVF-M25C', 0.4, 7, 0, 16),
	new CCD('Starlight Xpress SXVF-H35/36', 0.9, 12, 0, 16)
);


function CalculateSkyLimitedExposureDialog()
{
   this.__base__ = Dialog;
   this.__base__();
/*
   this.helpLabel = new Label( this );
   with (this.helpLabel )
   {
      frameStyle = FrameStyle_Box;
      margin = 4;
      wordWrapping = true;
      useRichText = true;
      text = "<p><b>" + #TITLE + " - " + #VERSION + "</b></p>" +
             "<p>This script uses various models to calculate an optimal subexposure length. The read noise limited models find " +
             "the exposure at which the cost of readout noise is low enough to be insignificant relative to the sky noise. The Anstey model " +
             "finds the exposure at which low strength target signals can be differentiated from background noise without being affected by " +
             "quantization and truncation. With a dark background level an very long exposure " +
             "is required before the background noise overcomes the readout noise. In this case it probably makes more sense to use the Anstey model." +
             "<p><b>Usage</b> - Select your camera and provide a background image.  In most cases simply using a preview frame containing only background will be sufficient.</p>";
   }
*/
   // Lengths in pixels of the longest labels, for visual alignment (+ T for security).
   var labelWidth1 = this.font.width( "Readout noise tollerance (%):" + 'T' );
   var labelWidth2 = this.font.width( "Suggested subexposure:" + 'T' );

   // Fixed length in pixels for all numeric edit controls, for visual alignment.
   var editWidth1 = this.font.width( "00000000" );

   /////////////////
   // CAMERA DATA //
   /////////////////

   // Preset list
   //
   this.cameraPresetList = new ComboBox(this);
   with(this.cameraPresetList)
   {
      for(var i=0; i < cameraPresets.length; ++i)
      {
         var camera = cameraPresets[i];
         addItem(camera.name);
      }

      onItemSelected = function( index )
      {
         var camera = cameraPresets[index];
         engine.ccd.readnoise = camera.readnoise;
         engine.ccd.gain = camera.gain;
         engine.ccd.bitsPerChannel = camera.bitsPerChannel;
         engine.ccd.darkCurrentNoise = camera.darkCurrentNoise;
         dialog.refreshUiValues();
      }
   }

   // Max Count
   //
   this.bitsPerChannelValue = new NumericControl(this);
   with(this.bitsPerChannelValue)
   {
      label.text = "ADU Bits:";
      label.minWidth = labelWidth1;
      toolTip = "<p>The number of bits per pixel</p>";
      setRange(0,32);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 ); // ### Note: Do this after setRange() and setPrecision()

      onValueUpdated = function( value )
      {
         engine.ccd.bitsPerChannel = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   // Gain
   //
   this.gainValue = new NumericControl(this);
   with(this.gainValue)
   {
      label.useRichText = true;
      label.text = "Gain (" + htmlFraction("e-", "ADU") + "):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The gain (e-/ADU) for your camera</p>";
      setRange(0,30);
      setPrecision(2);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.ccd.gain = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   // Readout noise
   //
   this.readoutNoiseValue = new NumericControl(this);
   with(this.readoutNoiseValue)
   {
      label.text = "Readout Noise (e-):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The documented readout noise (in e-) for your camera.  Consult the manufacturer for this value.</p>";
      setRange(0,100);
      setPrecision(2);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.ccd.readnoise = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   // Dark noise
   //
   this.darkNoiseValue = new NumericControl(this);
   with(this.darkNoiseValue)
   {
      label.useRichText = true;
      label.text = "Dark Noise (" + htmlFraction("e-", "s") + "):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The dark noise (in e-/s) for your camera.  This can be computed by comparing the noise after subtracting one dark frame from another.</p>";
      setRange(0,0.5);
      setPrecision(4);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.ccd.darkCurrentNoise = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var cameraPropertiesSizer = new VerticalSizer(this);
   with(cameraPropertiesSizer)
   {
      spacing = 4;
      margin = 8;
      add(this.cameraPresetList);
      add(this.bitsPerChannelValue);
      add(this.gainValue);
      add(this.readoutNoiseValue);
      add(this.darkNoiseValue);
   }

   var cameraPropertiesGroup = new GroupBox(this);
   with(cameraPropertiesGroup)
   {
      title = "Camera";
      sizer = cameraPropertiesSizer;
   }


   ///////////////////////////
   // Background Properties //
   ///////////////////////////

   this.backgroundImageList = new ViewList( this );
   with ( this.backgroundImageList )
   {
      getAll();
      toolTip = "<p>Select the image to sample for background level</p>";

      onViewSelected = function( view )
      {
         engine.backgroundImageData.setView(view);
         dialog.refreshUiValues();
      };
   }

   this.backgroundExposureValue = new NumericControl(this);
   with(this.backgroundExposureValue)
   {
      label.text = "Exposure (s):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The exposure in seconds</p>";
      setRange(0,900);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.backgroundImageData.exposure = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   this.backgroundPedestalValue = new NumericControl(this);
   with(this.backgroundPedestalValue)
   {
      label.text = "Pedestal:";
      label.minWidth = labelWidth1;
      toolTip = "<p>The pedestal added to the values in the image</p>";
      setRange(-300,300);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.backgroundImageData.pedestal = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   this.backgroundBinningValue = new NumericControl(this);
   with(this.backgroundBinningValue)
   {
      label.text = "Binning:";
      label.minWidth = labelWidth1;
      toolTip = "<p>The binning factor, use a value of '1' for no binning.</p>";
      setRange(1,4);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.backgroundImageData.binning = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var backgroundImagePropertiesSizer = new VerticalSizer(this);
   with(backgroundImagePropertiesSizer)
   {
      spacing = 4;
      margin = 8;
      add(this.backgroundImageList);
      add(this.backgroundExposureValue);
      add(this.backgroundPedestalValue);
      add(this.backgroundBinningValue);
   }

   var backgroundImagePropertiesGroup = new GroupBox(this);
   with(backgroundImagePropertiesGroup)
   {
      title = "Background Image";
      sizer = backgroundImagePropertiesSizer;
   }


   /////////////
   // Options //
   /////////////

   // Acceptable noise contribution
   //
   this.readoutNoisePctValue = new NumericControl(this);
   with(this.readoutNoisePctValue)
   {
      label.useRichText = true;
      label.text = "E<sub>readout</sub> tollerance (%):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The acceptable amount of readout noise relative to sky noise.  The suggested value is 5%.</p>";
      setRange(0,100);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.readoutNoisePct = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   this.totalExposureValue = new NumericControl(this);
   with(this.totalExposureValue)
   {
      label.text = "Total Exposure (s):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The total exposure time in seconds.  This is the sum of all subexposures times.</p>";
      setRange(0,14400);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.totalExposure = parseFloat(value);
         dialog.refreshUiValues();
      }
   }

   this.minimumTargetAduValue = new NumericControl(this);
   with(this.minimumTargetAduValue)
   {
      label.text = "Minimum Target (ADU):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The minimum ADU value that a target must reach. This should be at least '15' to ensure enough room for a normal distribution.</p>";
      setRange(0,100);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.minimumTargetAdu = parseFloat(value);
         dialog.refreshUiValues();
      }
   }

   var optionSizer = new VerticalSizer(this);
   with(optionSizer)
   {
      spacing = 4;
      margin = 8;
      add(this.readoutNoisePctValue);
      add(this.totalExposureValue);
      add(this.minimumTargetAduValue);
   }

   var optionGroup = new GroupBox( this );
   with ( optionGroup )
   {
      title = "Options";
      sizer = optionSizer;
   }


   /////////////
   // Results //
   /////////////

   // Chart
   //
   this.chartControl = new Control( this );
   with(this.chartControl)
   {
      setFixedSize(100,100);
      onPaint = function()
      {
         engine.drawChart(this);
      }
   }

   // Flux value
   //

   this.backgroundFluxLabel = new Label( this );
   with(this.backgroundFluxLabel)
   {
      minWidth = labelWidth2;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Background flux:";
   }

   this.backgroundFluxValue = new Label( this );
   with(this.backgroundFluxValue)
   {
      useRichText = true;
      foregroundColor = 0xff0000ff;
      textAlignment = TextAlign_Left|TextAlign_VertCenter;
   }

   var backgroundFluxSizer = new HorizontalSizer( this );
   with(backgroundFluxSizer)
   {
      spacing = 4;
      add(this.backgroundFluxLabel);
      add(this.backgroundFluxValue, 100);
   }

   // Limit value
   //
   this.limitedExposureLabel = new Label( this );
   with(this.limitedExposureLabel)
   {
      useRichText = true;
      minWidth = labelWidth2;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "E<sub>readout</sub> limit (I):";
   }

   this.limitedExposureValue = new Label( this );
   with(this.limitedExposureValue)
   {
      foregroundColor = 0xff0000ff;
      textAlignment = TextAlign_Left|TextAlign_VertCenter;
   }

   var limitedExposureSizer = new HorizontalSizer( this );
   with(limitedExposureSizer)
   {
      spacing = 4;
      add(this.limitedExposureLabel);
      add(this.limitedExposureValue, 100);
   }

   // Limit value II
   //
   this.limitedExposure2Label = new Label( this );
   with(this.limitedExposure2Label)
   {
      useRichText = true;
      minWidth = labelWidth2;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "E<sub>readout</sub> limit (II):";
   }

   this.limitedExposure2Value = new Label( this );
   with(this.limitedExposure2Value)
   {
      foregroundColor = 0xff0000ff;
      textAlignment = TextAlign_Left|TextAlign_VertCenter;
   }

   var limitedExposure2Sizer = new HorizontalSizer( this );
   with(limitedExposure2Sizer)
   {
      spacing = 4;
      add(this.limitedExposure2Label);
      add(this.limitedExposure2Value, 100);
   }

   // Anstey Model
   //
   this.ansteySubexposureLabel = new Label( this );
   with(this.ansteySubexposureLabel)
   {
      minWidth = labelWidth2;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Anstey limit:";
   }

   this.ansteySubexposureValue = new Label( this );
   with(this.ansteySubexposureValue)
   {
      foregroundColor = 0xff0000ff;
      textAlignment = TextAlign_Left|TextAlign_VertCenter;
   }

   var ansteySubexposureSizer = new HorizontalSizer( this );
   with(ansteySubexposureSizer)
   {
      spacing = 4;
      add(this.ansteySubexposureLabel);
      add(this.ansteySubexposureValue, 100);
   }

   var resultsSizer = new VerticalSizer(this);
   with(resultsSizer)
   {
      spacing = 4;
      margin = 8;
      add(this.chartControl);
      add(backgroundFluxSizer);
      add(limitedExposureSizer);
      add(limitedExposure2Sizer);
      add(ansteySubexposureSizer);
   }

   var resultsGroup = new GroupBox(this);
   with(resultsGroup)
   {
      title = "Results";
      sizer = resultsSizer;
   }

   // Collect everything
   //
   this.sizer = new VerticalSizer;
   with(this.sizer)
   {
      spacing = 4;
      margin = 8;
      //add(this.helpLabel);
      add(cameraPropertiesGroup);
      add(backgroundImagePropertiesGroup);
      add(optionGroup);
      add(resultsGroup);
   }

   this.windowTitle = #TITLE + " Script";
   this.setFixedWidth( 420 );
   this.adjustToContents();
   //this.setFixedSize(); // the dialog does not always open to the right size on small screens

   this.colorizeForErrors = function(control, expression)
   {
      var invalidBackgroundColor = 0xffff0000;
      var validBackgroundColor = 0xffffffff;

      if(expression)
         control.backgroundColor = validBackgroundColor;
      else
         control.backgroundColor = invalidBackgroundColor;

   }

   this.refreshUiValues = function()
   {
      var invalidBackgroundColor = 0xffff0000;
      var validBackgroundColor = 0xffffffff;

      // Background properties
      //
      this.backgroundPedestalValue.setValue(engine.backgroundImageData.pedestal);
      this.backgroundExposureValue.setValue(engine.backgroundImageData.exposure);
      this.colorizeForErrors(this.backgroundExposureValue.edit, engine.backgroundImageData.exposure > 0);
      this.backgroundBinningValue.setValue(engine.backgroundImageData.binning);

      // CCD properties
      //
      this.gainValue.setValue(engine.ccd.gain);
      this.colorizeForErrors(this.gainValue.edit, engine.ccd.gain > 0);

      this.bitsPerChannelValue.setValue(engine.ccd.bitsPerChannel);
      this.colorizeForErrors(this.bitsPerChannelValue.edit, engine.ccd.bitsPerChannel > 0);

      this.readoutNoiseValue.setValue(engine.ccd.readnoise);
      this.colorizeForErrors(this.readoutNoiseValue.edit, engine.ccd.readnoise > 0);

      this.darkNoiseValue.setValue(engine.ccd.darkCurrentNoise);
      //this.colorizeForErrors(this.darkNoiseValue.edit, engine.ccd.darkCurrentNoise > 0);

      // Options
      //
      this.readoutNoisePctValue.setValue(engine.readoutNoisePct);
      this.colorizeForErrors(this.readoutNoisePctValue.edit, engine.readoutNoisePct > 0);

      this.colorizeForErrors(this.totalExposureValue.edit, engine.totalExposure > 0);
      this.totalExposureValue.setValue(engine.totalExposure);

      this.colorizeForErrors(this.minimumTargetAduValue.edit, engine.minimumTargetAdu > 0);
      this.minimumTargetAduValue.setValue(engine.minimumTargetAdu);

      if(engine.isValid())
      {
         engine.generate();
         this.backgroundFluxValue.text = engine.backgroundFluxString();
         this.limitedExposureValue.text = engine.limitedExposureString();
         this.limitedExposure2Value.text = engine.limitedExposure2String();
         this.ansteySubexposureValue.text = engine.ansteyLimitedExposureString();
      }
      else
      {
         this.backgroundFluxValue.text = "";
         this.limitedExposureValue.text = "";
         this.limitedExposure2Value.text = "";
         this.ansteySubexposureValue.text = "";
      }
   }

   this.refreshUiValues();
}

CalculateSkyLimitedExposureDialog.prototype = new Dialog;

var dialog = new CalculateSkyLimitedExposureDialog;
console.hide();
dialog.execute();


