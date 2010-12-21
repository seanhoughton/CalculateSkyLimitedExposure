<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">

<xsl:param name="NAME"/>

<xsl:template match="@fileName">
    <xsl:attribute name="fileName">
       <xsl:value-of select="$NAME"/>
    </xsl:attribute>
</xsl:template>

<xsl:template match="@releaseDate">
    <xsl:attribute name="releaseDate">
       <xsl:value-of select="$RELEASE_DATE"/>
    </xsl:attribute>
</xsl:template>

<xsl:template match="@version">
    <xsl:attribute name="version">
       <xsl:value-of select="$VERSION"/>
    </xsl:attribute>
</xsl:template>

<xsl:template match="@sha1">
    <xsl:attribute name="sha1">
       <xsl:value-of select="$SHA1"/>
    </xsl:attribute>
</xsl:template>


<xsl:template match="@*|node()">
	<xsl:copy>
		<xsl:apply-templates select="@*|node()"/>
	</xsl:copy>
</xsl:template>

</xsl:stylesheet>